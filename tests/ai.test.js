import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';
const uploadDir = mkdtempSync(path.join(os.tmpdir(), 'giggo-ai-test-'));
process.env.UPLOAD_DIR = uploadDir;

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { AIAnalysis } = await import('../src/models/AIAnalysis.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { ClientProfile } = await import('../src/models/ClientProfile.js');
const { User } = await import('../src/models/User.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claimsByToken = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  const claims = claimsByToken.get(token);
  if (!claims) throw new Error('Unknown test token');
  return claims;
});

const app = createApp();
const sample = [
  'Summary: Full-stack React developer with 6 years experience.',
  'Contact: ana@example.test and github.com/ana.',
  'Experience: Built Node.js services and reduced page load time by 40% for 500 users.',
  'Skills: JavaScript, React, Node.js, MongoDB, Docker.',
  'Education: BSc Computer Science.',
].join('\n');

async function register(role, email) {
  const token = `token-${email}`;
  claimsByToken.set(token, {
    sub: `identity-${email}`,
    email,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: `${role} account`, signup_role: role },
  });
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  return token;
}

before(async () => connectDB());
beforeEach(async () => {
  claimsByToken.clear();
  await Promise.all([
    User.deleteMany({}),
    AIAnalysis.deleteMany({}),
    FreelancerProfile.deleteMany({}),
    ClientProfile.deleteMany({}),
  ]);
});
after(async () => {
  await disconnectDB();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

test('freelancer can analyze text, reuse cache, manage history, and apply detected skills', async () => {
  const token = await register('freelancer', 'analysis@example.test');
  const otherToken = await register('freelancer', 'other@example.test');
  await request(app).get('/api/profiles/me').set('Authorization', `Bearer ${token}`).expect(200);

  const first = await request(app)
    .post('/api/ai/cv/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: sample })
    .expect(201);
  const analysis = first.body.data.analysis;
  assert.equal(analysis.provider, 'heuristic');
  assert.ok(analysis.result.overallScore > 0);
  assert.ok(analysis.result.detectedSkills.includes('react'));
  assert.equal('text' in analysis, false);

  const cached = await request(app)
    .post('/api/ai/cv/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: sample })
    .expect(201);
  assert.equal(cached.body.data.analysis._id, analysis._id);

  const forced = await request(app)
    .post('/api/ai/cv/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: sample, force: true })
    .expect(201);
  assert.notEqual(forced.body.data.analysis._id, analysis._id);

  const history = await request(app).get('/api/ai/cv/analyses?limit=10').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(history.body.data.pagination.total, 2);
  const latest = await request(app).get('/api/ai/cv/latest').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(latest.body.data.analysis._id, forced.body.data.analysis._id);

  await request(app).get(`/api/ai/cv/analyses/${analysis._id}`).set('Authorization', `Bearer ${otherToken}`).expect(404);

  const applied = await request(app)
    .post(`/api/ai/cv/analyses/${analysis._id}/apply-skills`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.ok(applied.body.data.added.includes('react'));
  assert.equal('storageKey' in applied.body.data.profile.cv, false);

  await request(app).delete(`/api/ai/cv/analyses/${analysis._id}`).set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).get(`/api/ai/cv/analyses/${analysis._id}`).set('Authorization', `Bearer ${token}`).expect(404);
});

test('uploaded TXT CV is private, extractable, analyzable, replaceable, and removable', async () => {
  const token = await register('freelancer', 'upload@example.test');
  const uploaded = await request(app)
    .post('/api/profiles/me/cv')
    .set('Authorization', `Bearer ${token}`)
    .attach('document', Buffer.from(sample), { filename: 'resume.txt', contentType: 'text/plain' })
    .expect(200);

  assert.equal(uploaded.body.data.profile.cv.filename, 'resume.txt');
  assert.equal('storageKey' in uploaded.body.data.profile.cv, false);

  const analysis = await request(app)
    .post('/api/ai/cv/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(201);
  assert.equal(analysis.body.data.analysis.source.kind, 'cv_file');
  assert.equal(analysis.body.data.analysis.source.filename, 'resume.txt');

  await request(app)
    .post('/api/profiles/me/cv')
    .set('Authorization', `Bearer ${token}`)
    .attach('document', Buffer.from(`${sample}\nUpdated.`), { filename: 'resume-updated.txt', contentType: 'text/plain' })
    .expect(200);
  assert.equal((await fs.readdir(uploadDir)).length, 1);

  const removed = await request(app).delete('/api/profiles/me/cv').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(removed.body.data.profile.cv.filename, '');
  assert.equal((await fs.readdir(uploadDir)).length, 0);
});

test('CV analysis validates authentication, role, content, and upload type', async () => {
  const freelancerToken = await register('freelancer', 'validation@example.test');
  const clientToken = await register('client', 'client-ai@example.test');

  await request(app).post('/api/ai/cv/analyze').send({ text: sample }).expect(401);
  await request(app).post('/api/ai/cv/analyze').set('Authorization', `Bearer ${clientToken}`).send({ text: sample }).expect(403);
  await request(app).post('/api/ai/cv/analyze').set('Authorization', `Bearer ${freelancerToken}`).send({ text: 'too short' }).expect(400);
  await request(app).post('/api/ai/cv/analyze').set('Authorization', `Bearer ${freelancerToken}`).send({}).expect(400);
  await request(app)
    .post('/api/profiles/me/cv')
    .set('Authorization', `Bearer ${freelancerToken}`)
    .attach('document', Buffer.from('not an image'), { filename: 'photo.png', contentType: 'image/png' })
    .expect(400);
});

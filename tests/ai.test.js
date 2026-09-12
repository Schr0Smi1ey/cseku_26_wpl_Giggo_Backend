import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { User } = await import('../src/models/User.js');
const { AIAnalysis } = await import('../src/models/AIAnalysis.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');
const claims = new Map(); setSupabaseTokenVerifierForTests(async (token) => { if (!claims.has(token)) throw new Error('Unknown token'); return claims.get(token); });
const app = createApp(); const access = 'freelancer-token'; const sample = 'Summary: React developer with 6 years experience. Contact: ana@example.test. Experience: reduced page load time by 40%. Skills: JavaScript, React, Node.js, MongoDB. Education: BSc Computer Science.';
before(async () => connectDB()); beforeEach(async () => { claims.clear(); claims.set(access, { sub: 'ai-user', email: 'ai@example.test', user_metadata: { name: 'AI User', signup_role: 'freelancer' } }); await Promise.all([User.deleteMany({}), AIAnalysis.deleteMany({}), FreelancerProfile.deleteMany({})]); }); after(async () => disconnectDB());

test('freelancer CV analysis is scored, cached, and owner-scoped', async () => {
  const first = await request(app).post('/api/ai/cv/analyze').set('Authorization', `Bearer ${access}`).send({ text: sample }).expect(201); const analysis = first.body.data.analysis;
  assert.ok(analysis.result.overallScore > 0); assert.ok(analysis.result.detectedSkills.includes('react'));
  const second = await request(app).post('/api/ai/cv/analyze').set('Authorization', `Bearer ${access}`).send({ text: sample }).expect(201);
  assert.equal(second.body.data.analysis._id, analysis._id);
  await request(app).get('/api/ai/cv/analyses').set('Authorization', `Bearer ${access}`).expect(200).expect((res) => assert.equal(res.body.data.pagination.total, 1));
});

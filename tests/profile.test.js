import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';
const avatarDir = mkdtempSync(path.join(os.tmpdir(), 'giggo-avatar-test-'));
process.env.AVATAR_UPLOAD_DIR = avatarDir;

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { ClientProfile } = await import('../src/models/ClientProfile.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { User } = await import('../src/models/User.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claimsByToken = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  const claims = claimsByToken.get(token);
  if (!claims) throw new Error('Unknown test token');
  return claims;
});

const app = createApp();

before(async () => connectDB());
beforeEach(async () => {
  claimsByToken.clear();
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    FreelancerProfile.deleteMany({}),
    ClientProfile.deleteMany({}),
    fs.rm(avatarDir, { recursive: true, force: true }),
  ]);
});
after(async () => {
  await fs.rm(avatarDir, { recursive: true, force: true });
  await disconnectDB();
});

async function register(role, email) {
  const token = `supabase-test-${email}`;
  claimsByToken.set(token, {
    sub: `id-${email}`,
    email,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: `${role} account`, signup_role: role },
  });
  const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  return { token, user: response.body.data.user };
}

const freelancerOnboarding = {
  title: 'Full-stack developer',
  category: 'Development & IT',
  overview: 'I build reliable React and Node.js applications for small teams and growing businesses.',
  skills: ['React', 'Node.js', 'MongoDB'],
  hourlyRate: 45,
  availability: 'full_time',
  location: { country: 'Bangladesh', city: 'Khulna', timezone: 'Asia/Dhaka' },
  languages: [{ name: 'English', proficiency: 'fluent' }],
};

const clientOnboarding = {
  companyName: 'Giggo Labs',
  companyDescription: 'A small product team building practical tools for businesses in Bangladesh and beyond.',
  industry: 'Software',
  website: 'https://giggo.example',
  teamSize: '1-10',
  location: { country: 'Bangladesh', city: 'Khulna' },
};

test('freelancer onboarding creates a public profile that can be discovered', async () => {
  const { token, user } = await register('freelancer', 'freelancer.profile@example.com');
  const completed = await request(app)
    .post('/api/profiles/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send(freelancerOnboarding)
    .expect(200);

  assert.equal(completed.body.data.profile.type, 'freelancer');
  assert.equal(completed.body.data.profile.onboardingCompleted, true);
  assert.equal(completed.body.data.profile.visibility, 'public');
  assert.equal(completed.body.data.profile.completeness, 73);

  const mine = await request(app).get('/api/profiles/me').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(mine.body.data.profile.user, user._id);

  const directory = await request(app).get('/api/profiles/talent?search=Node&sort=recent').expect(200);
  assert.equal(directory.body.data.items.length, 1);
  assert.equal(directory.body.data.items[0].user.name, user.name);
  assert.equal('email' in directory.body.data.items[0].user, false);

  const publicProfile = await request(app).get(`/api/profiles/${user._id}`).expect(200);
  assert.equal(publicProfile.body.data.profile.title, freelancerOnboarding.title);
});

test('freelancers can update bounded profile sections after onboarding', async () => {
  const { token } = await register('freelancer', 'freelancer.update@example.com');
  await request(app).post('/api/profiles/me/onboarding').set('Authorization', `Bearer ${token}`).send(freelancerOnboarding).expect(200);
  const updated = await request(app)
    .patch('/api/profiles/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ portfolio: [{ title: 'Giggo web app', description: 'A production-ready marketplace foundation.', url: 'https://giggo.example/project', image: '', tags: ['React'] }] })
    .expect(200);
  assert.equal(updated.body.data.profile.portfolio.length, 1);
  assert.equal(updated.body.data.profile.completeness, 83);
});

test('client onboarding persists a separate company profile and rejects freelancer fields', async () => {
  const { token, user } = await register('client', 'client.profile@example.com');
  const completed = await request(app)
    .post('/api/profiles/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send(clientOnboarding)
    .expect(200);
  assert.equal(completed.body.data.profile.type, 'client');
  assert.equal(completed.body.data.profile.companyName, clientOnboarding.companyName);
  assert.equal(completed.body.data.profile.completeness, 100);

  await request(app).patch('/api/profiles/me').set('Authorization', `Bearer ${token}`).send({ title: 'Not a company field' }).expect(400);
  await request(app).get(`/api/profiles/${user._id}`).expect(404);
});

test('authenticated users can upload, replace, serve, and remove a profile photo', async () => {
  const { token, user } = await register('freelancer', 'avatar.profile@example.com');
  await request(app)
    .post('/api/profiles/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send(freelancerOnboarding)
    .expect(200);

  const firstPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZQAAAAASUVORK5CYII=', 'base64');
  const firstUpload = await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', firstPng, { filename: 'profile.png', contentType: 'image/png' })
    .expect(200);

  const firstUrl = firstUpload.body.data.avatar;
  assert.match(firstUrl, /^\/api\/profiles\/avatars\/[0-9a-f-]+\.png$/i);
  const storedUser = await User.findById(user._id).select('+avatarStorageKey +avatarStorageProvider');
  assert.equal(storedUser.avatar, firstUrl);
  assert.equal(path.dirname(storedUser.avatarStorageKey), avatarDir);
  assert.equal(storedUser.avatarStorageProvider, 'local');

  const served = await request(app).get(firstUrl).expect(200).expect('Content-Type', /image\/png/);
  assert.deepEqual(served.body, firstPng);

  const publicProfile = await request(app).get(`/api/profiles/${user._id}`).expect(200);
  assert.equal(publicProfile.body.data.profile.user.avatar, firstUrl);
  assert.equal('avatarStorageKey' in publicProfile.body.data.profile.user, false);
  assert.equal('avatarStorageProvider' in publicProfile.body.data.profile.user, false);

  const secondPng = Buffer.concat([firstPng, Buffer.from([0])]);
  const replacement = await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', secondPng, { filename: 'replacement.png', contentType: 'image/png' })
    .expect(200);
  assert.notEqual(replacement.body.data.avatar, firstUrl);
  await request(app).get(firstUrl).expect(404);
  await request(app).get(replacement.body.data.avatar).expect(200);

  const removed = await request(app)
    .delete('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(removed.body.data.avatar, '');
  await request(app).get(replacement.body.data.avatar).expect(404);
});

test('profile photo uploads reject unauthenticated, unsupported, and spoofed files', async () => {
  const { token } = await register('client', 'avatar.validation@example.com');
  const fakeImage = Buffer.from('not an image');

  await request(app)
    .post('/api/profiles/me/avatar')
    .attach('image', fakeImage, { filename: 'profile.png', contentType: 'image/png' })
    .expect(401);

  await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', fakeImage, { filename: 'profile.gif', contentType: 'image/gif' })
    .expect(400);

  const spoofed = await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', fakeImage, { filename: 'profile.png', contentType: 'image/png' })
    .expect(400);
  assert.equal(spoofed.body.error.code, 'VALIDATION_ERROR');

  const oversized = await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', Buffer.alloc((5 * 1024 * 1024) + 1, 0xff), { filename: 'large.jpg', contentType: 'image/jpeg' })
    .expect(413);
  assert.equal(oversized.body.error.code, 'FILE_TOO_LARGE');

  await request(app).get('/api/profiles/avatars/not-a-valid-name.png').expect(404);
});

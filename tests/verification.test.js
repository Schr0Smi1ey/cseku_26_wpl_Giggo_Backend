import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.UPLOAD_DIR = path.join(process.cwd(), '.test-runtime');

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { ClientProfile } = await import('../src/models/ClientProfile.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { User, ROLES } = await import('../src/models/User.js');
const { VerificationRequest } = await import('../src/models/VerificationRequest.js');
const { resetVerificationTestState } = await import('../src/services/verification.service.js');

const app = createApp();

before(async () => connectDB());
beforeEach(async () => {
  resetVerificationTestState();
  await Promise.all([
    VerificationRequest.deleteMany({}),
    RefreshToken.deleteMany({}),
    FreelancerProfile.deleteMany({}),
    ClientProfile.deleteMany({}),
    User.deleteMany({}),
  ]);
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => {
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await disconnectDB();
});

async function register(role, email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} verification tester`, email, password: 'StrongPass1', role })
    .expect(201);
  return { token: response.body.data.accessToken, user: response.body.data.user };
}

async function createAdminToken() {
  const admin = new User({ name: 'Giggo Reviewer', email: 'reviewer@example.com', role: ROLES.ADMIN, roles: [ROLES.ADMIN] });
  await admin.setPassword('StrongPass1');
  await admin.save();
  const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'StrongPass1' }).expect(200);
  return login.body.data.accessToken;
}

async function completeFreelancerOnboarding(token) {
  await request(app)
    .post('/api/profiles/me/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Verification test developer',
      category: 'Development & IT',
      overview: 'A freelancer profile used to verify that public trust badges are derived only from human review decisions.',
      skills: ['React', 'Node.js', 'MongoDB'],
      hourlyRate: 30,
      availability: 'full_time',
      languages: [{ name: 'English', proficiency: 'fluent' }],
      location: { country: 'Bangladesh', city: 'Khulna', timezone: 'Asia/Dhaka' },
    })
    .expect(200);
}

test('freelancers can verify email and phone without a third-party provider', async () => {
  const { token } = await register('freelancer', 'verification.signals@example.com');
  await request(app).get('/api/profiles/me').set('Authorization', `Bearer ${token}`).expect(200);

  const email = await request(app).post('/api/verification/email/resend').set('Authorization', `Bearer ${token}`).expect(200);
  assert.ok(email.body.data.devVerifyToken);
  await request(app).post('/api/auth/verify-email').send({ token: email.body.data.devVerifyToken }).expect(200);

  const sent = await request(app).post('/api/verification/phone/send').set('Authorization', `Bearer ${token}`).send({ phone: '+880 1712 345678' }).expect(200);
  assert.match(sent.body.data.devCode, /^\d{6}$/);
  await request(app).post('/api/verification/phone/verify').set('Authorization', `Bearer ${token}`).send({ code: sent.body.data.devCode }).expect(200);

  const status = await request(app).get('/api/verification/status').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(status.body.data.emailVerified, true);
  assert.equal(status.body.data.phoneVerified, true);
  assert.ok(status.body.data.badges.includes('email_verified'));
  assert.ok(status.body.data.badges.includes('phone_verified'));
});

test('only a human admin decision grants a public verification badge', async () => {
  const { token, user } = await register('freelancer', 'verification.request@example.com');
  await completeFreelancerOnboarding(token);
  const adminToken = await createAdminToken();

  const submitted = await request(app)
    .post('/api/verification/requests')
    .set('Authorization', `Bearer ${token}`)
    .field('type', 'identity')
    .field('note', 'Government ID supplied for review')
    .attach('documents', Buffer.from('%PDF-1.4 private evidence'), { filename: 'identity.pdf', contentType: 'application/pdf' })
    .expect(201);
  const requestId = submitted.body.data.request._id;
  assert.equal(submitted.body.data.request.status, 'pending');
  assert.equal('path' in submitted.body.data.request.documents[0], false);

  await request(app)
    .post('/api/verification/requests')
    .set('Authorization', `Bearer ${token}`)
    .field('type', 'identity')
    .attach('documents', Buffer.from('duplicate'), { filename: 'second.pdf', contentType: 'application/pdf' })
    .expect(409);

  await request(app).get('/api/verification/admin/requests').set('Authorization', `Bearer ${token}`).expect(403);
  const queue = await request(app).get('/api/verification/admin/requests').set('Authorization', `Bearer ${adminToken}`).expect(200);
  assert.ok(queue.body.data.items.some((item) => item._id === requestId));

  await request(app)
    .get(`/api/verification/admin/requests/${requestId}/documents/0`)
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
  const document = await request(app)
    .get(`/api/verification/admin/requests/${requestId}/documents/0`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  assert.match(document.headers['content-disposition'], /identity\.pdf/);

  const approved = await request(app)
    .post(`/api/verification/admin/requests/${requestId}/decision`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'approve', reviewNote: 'Reviewed by a Giggo administrator.' })
    .expect(200);
  assert.equal(approved.body.data.request.status, 'approved');

  await request(app)
    .post(`/api/verification/admin/requests/${requestId}/decision`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'reject' })
    .expect(400);

  const publicProfile = await request(app).get(`/api/profiles/${user._id}`).expect(200);
  assert.equal(publicProfile.body.data.profile.verificationState, 'VERIFIED');
  assert.ok(publicProfile.body.data.profile.badges.includes('identity_verified'));
  assert.ok(publicProfile.body.data.profile.badges.includes('verified'));
});

test('clients cannot create freelancer verification requests and freelancers can cancel pending work', async () => {
  const client = await register('client', 'verification.client@example.com');
  await request(app).get('/api/verification/status').set('Authorization', `Bearer ${client.token}`).expect(403);

  const freelancer = await register('freelancer', 'verification.cancel@example.com');
  const submitted = await request(app)
    .post('/api/verification/requests')
    .set('Authorization', `Bearer ${freelancer.token}`)
    .field('type', 'document')
    .attach('documents', Buffer.from('private certificate'), { filename: 'certificate.txt', contentType: 'text/plain' })
    .expect(201);

  const cancelled = await request(app)
    .delete(`/api/verification/requests/${submitted.body.data.request._id}`)
    .set('Authorization', `Bearer ${freelancer.token}`)
    .expect(200);
  assert.equal(cancelled.body.data.request.status, 'cancelled');
});

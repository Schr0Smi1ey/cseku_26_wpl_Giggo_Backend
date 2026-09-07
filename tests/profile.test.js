import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { ClientProfile } = await import('../src/models/ClientProfile.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { User } = await import('../src/models/User.js');

const app = createApp();

before(async () => connectDB());
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), FreelancerProfile.deleteMany({}), ClientProfile.deleteMany({})]);
});
after(async () => disconnectDB());

async function register(role, email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} account`, email, password: 'StrongPass1', role })
    .expect(201);
  return { token: response.body.data.accessToken, user: response.body.data.user };
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

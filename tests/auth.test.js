import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { User } = await import('../src/models/User.js');

const app = createApp();

before(async () => connectDB());
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
});
after(async () => disconnectDB());

const client = { name: 'Giggo Client', email: 'client@example.com', password: 'StrongPass1', role: 'client' };
const freelancer = { name: 'Giggo Freelancer', email: 'freelancer@example.com', password: 'StrongPass1', role: 'freelancer' };

test('register creates a client session without exposing a password hash', async () => {
  const response = await request(app).post('/api/auth/register').send(client).expect(201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.user.email, client.email);
  assert.equal(response.body.data.user.role, 'client');
  assert.equal('passwordHash' in response.body.data.user, false);
  assert.match(response.headers['set-cookie'][0], /refreshToken=/);
});

test('registration rejects duplicate email and invalid roles', async () => {
  await request(app).post('/api/auth/register').send(client).expect(201);
  await request(app).post('/api/auth/register').send(client).expect(409);
  await request(app)
    .post('/api/auth/register')
    .send({ ...freelancer, email: 'other@example.com', role: 'admin' })
    .expect(400);
});

test('login, protected identity, refresh rotation, and logout work together', async () => {
  await request(app).post('/api/auth/register').send(freelancer).expect(201);
  await request(app).post('/api/auth/login').send({ email: freelancer.email, password: 'WrongPass1' }).expect(401);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: freelancer.email, password: 'StrongPass1' })
    .expect(200);
  const accessToken = login.body.data.accessToken;
  const cookie = login.headers['set-cookie'][0].split(';')[0];

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
  assert.equal(me.body.data.user.role, 'freelancer');

  const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
  assert.equal(typeof refreshed.body.data.accessToken, 'string');
  const nextCookie = refreshed.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(nextCookie, cookie);

  await request(app).post('/api/auth/logout').set('Cookie', nextCookie).expect(200);
  await request(app).post('/api/auth/refresh').set('Cookie', nextCookie).expect(401);
});

test('protected identity rejects missing or invalid access tokens', async () => {
  await request(app).get('/api/auth/me').expect(401);
  await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid-token').expect(401);
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { User } = await import('../src/models/User.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claimsByToken = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  const claims = claimsByToken.get(token);
  if (!claims) throw new Error('Unknown test token');
  return claims;
});

const app = createApp();

function tokenFor({ id, email, name = 'Giggo User', role = 'freelancer' }) {
  const token = `supabase-test-${id}`;
  claimsByToken.set(token, {
    sub: id,
    email,
    user_metadata: { name, signup_role: role },
  });
  return token;
}

before(async () => connectDB());
beforeEach(async () => {
  claimsByToken.clear();
  await User.deleteMany({});
});
after(async () => disconnectDB());

test('a verified Supabase session provisions a MongoDB user without a local password', async () => {
  const token = tokenFor({ id: 'user-1', email: 'freelancer@example.com', name: 'Giggo Freelancer' });
  const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

  assert.equal(response.body.data.user.email, 'freelancer@example.com');
  assert.equal(response.body.data.user.role, 'freelancer');
  assert.equal(response.body.data.user.emailVerified, true);
  assert.equal('passwordHash' in response.body.data.user, false);

  const user = await User.findOne({ email: 'freelancer@example.com' }).select('+passwordHash');
  assert.equal(user.authProvider, 'supabase');
  assert.equal(user.supabaseUserId, 'user-1');
  assert.equal(user.passwordHash, undefined);
});

test('untrusted signup metadata cannot create an admin and existing MongoDB roles are retained', async () => {
  const token = tokenFor({ id: 'user-2', email: 'new@example.com', role: 'admin' });
  const created = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(created.body.data.user.role, 'freelancer');

  await User.create({
    name: 'Existing Client',
    email: 'existing@example.com',
    role: 'client',
    roles: ['client'],
    passwordHash: 'legacy-hash',
  });
  const existingToken = tokenFor({ id: 'user-3', email: 'existing@example.com', role: 'freelancer' });
  const linked = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${existingToken}`).expect(200);
  assert.equal(linked.body.data.user.role, 'client');
  assert.equal(linked.body.data.user.supabaseUserId, 'user-3');
});

test('protected identity rejects missing and invalid Supabase sessions', async () => {
  await request(app).get('/api/auth/me').expect(401);
  await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid-token').expect(401);
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { User } = await import('../src/models/User.js');
const { Job } = await import('../src/models/Job.js');
const { SavedJob } = await import('../src/models/SavedJob.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');
const claims = new Map(); setSupabaseTokenVerifierForTests(async (token) => { if (!claims.has(token)) throw new Error('Unknown token'); return claims.get(token); });
const app = createApp(); const token = (id, email, role) => { const value = `token-${id}`; claims.set(value, { sub: id, email, user_metadata: { name: id, signup_role: role } }); return value; };
const body = { title: 'Build a React dashboard', description: 'Create a responsive analytics dashboard with reusable React components.', category: 'Development & IT', skills: ['React'], budget: { type: 'fixed', min: 500, max: 1200 } };
before(async () => connectDB()); beforeEach(async () => { claims.clear(); await Promise.all([User.deleteMany({}), Job.deleteMany({}), SavedJob.deleteMany({})]); }); after(async () => disconnectDB());

test('clients can post and manage jobs while freelancers can save public jobs', async () => {
  const client = token('client-1', 'client@example.test', 'client'); const freelancer = token('freelancer-1', 'freelancer@example.test', 'freelancer');
  const created = await request(app).post('/api/jobs').set('Authorization', `Bearer ${client}`).send(body).expect(201); const id = created.body.data.job._id;
  await request(app).get('/api/jobs').expect(200).expect((res) => assert.equal(res.body.data.items.length, 1));
  await request(app).post(`/api/jobs/${id}/save`).set('Authorization', `Bearer ${freelancer}`).expect(200);
  await request(app).get('/api/jobs/saved').set('Authorization', `Bearer ${freelancer}`).expect(200).expect((res) => assert.equal(res.body.data.items[0]._id, id));
  await request(app).patch(`/api/jobs/${id}`).set('Authorization', `Bearer ${freelancer}`).send({ title: 'Nope' }).expect(403);
});

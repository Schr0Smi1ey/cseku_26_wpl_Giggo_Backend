import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Contract } = await import('../src/models/Contract.js');
const { Conversation } = await import('../src/models/Conversation.js');
const { Job } = await import('../src/models/Job.js');
const { Message } = await import('../src/models/Message.js');
const { Milestone } = await import('../src/models/Milestone.js');
const { Notification } = await import('../src/models/Notification.js');
const { Offer } = await import('../src/models/Offer.js');
const { OfferRevision } = await import('../src/models/OfferRevision.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { Project } = await import('../src/models/Project.js');
const { User } = await import('../src/models/User.js');
const { WorkSubmission } = await import('../src/models/WorkSubmission.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown test token');
  return claims.get(token);
});

const app = createApp();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (id, role) => {
  const token = `contract-token-${id}`;
  claims.set(token, {
    sub: id,
    email: `${id}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: id, signup_role: role },
  });
  return token;
};

const jobBody = {
  title: 'Build a contract-backed dashboard',
  description: 'Create a responsive dashboard with a clearly auditable delivery contract and implementation scope.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'fixed', min: 800, max: 1200, currency: 'USD' },
};
const proposalBody = {
  coverLetter: 'I can deliver the dashboard with secure APIs, accessible components, tests, and complete setup documentation.',
  bid: { amount: 1000, type: 'fixed', currency: 'USD' },
  estimatedDays: 12,
  milestones: [{ title: 'Dashboard delivery', amount: 1000, description: 'Application, tests, and documentation.' }],
};
const offerBody = {
  title: 'Contract-backed dashboard delivery',
  description: 'Deliver the responsive dashboard with secure integration, tests, deployment notes, and documentation.',
  budget: { amount: 1000, type: 'fixed', currency: 'USD' },
  estimatedDays: 12,
  terms: 'The accepted revision is the immutable source for this contract.',
  milestones: [{ title: 'Dashboard delivery', amount: 1000, description: 'Application, tests, and documentation.' }],
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([
    WorkSubmission.deleteMany({}),
    Milestone.deleteMany({}),
    Contract.deleteMany({}),
    Message.deleteMany({}),
    Conversation.deleteMany({}),
    Notification.deleteMany({}),
    OfferRevision.deleteMany({}),
    Offer.deleteMany({}),
    Proposal.deleteMany({}),
    Project.deleteMany({}),
    Job.deleteMany({}),
    User.deleteMany({}),
  ]);
});
after(async () => disconnectDB());

async function acceptedContract(suffix, values = {}) {
  const clientToken = tokenFor(`contract-client-${suffix}`, 'client');
  const freelancerToken = tokenFor(`contract-freelancer-${suffix}`, 'freelancer');
  const outsiderToken = tokenFor(`contract-outsider-${suffix}`, 'client');
  await request(app).get('/api/auth/me').set(auth(outsiderToken)).expect(200);
  const job = (await request(app).post('/api/jobs').set(auth(clientToken)).send(values.job || jobBody).expect(201)).body.data.job;
  const proposal = (await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...(values.proposal || proposalBody) }).expect(201)).body.data.proposal;
  await request(app).post(`/api/proposals/${proposal._id}/decision`).set(auth(clientToken)).send({ decision: 'shortlist' }).expect(200);
  const offer = (await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...(values.offer || offerBody) }).expect(201)).body.data.offer;
  await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  const accepted = await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(200);
  return { clientToken, freelancerToken, outsiderToken, job, proposal, offer, accepted: accepted.body.data.offer };
}

test('accepting an offer creates one immutable participant-only contract and retries reuse it', async () => {
  const { clientToken, freelancerToken, outsiderToken, job, offer, accepted } = await acceptedContract('creation');
  assert.ok(accepted.contract);
  assert.equal(await Contract.countDocuments({ offer: offer._id }), 1);

  const stored = await Contract.findById(accepted.contract).lean();
  assert.equal(String(stored.job), job._id);
  assert.equal(stored.title, offerBody.title);
  assert.deepEqual(stored.budget, offerBody.budget);
  assert.equal(stored.milestones.length, 1);
  assert.equal(stored.status, 'active');
  assert.equal(stored.statusHistory.length, 1);
  assert.equal(stored.statusHistory[0].to, 'active');

  const repeated = await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(200);
  assert.equal(String(repeated.body.data.offer.contract), String(stored._id));
  assert.equal(await Contract.countDocuments({ offer: offer._id }), 1);

  const clientList = await request(app).get('/api/contracts?status=active').set(auth(clientToken)).expect(200);
  assert.equal(clientList.body.data.items.length, 1);
  await request(app).get(`/api/contracts/${stored._id}`).set(auth(freelancerToken)).expect(200);
  await request(app).get(`/api/contracts/${stored._id}`).set(auth(outsiderToken)).expect(404);
  await request(app).post(`/api/contracts/${stored._id}/status`).set(auth(outsiderToken)).send({ status: 'cancelled', note: 'Not my contract' }).expect(404);
});

test('hourly accepted offers create hourly contracts without fixed milestones', async () => {
  const hourly = await acceptedContract('hourly', {
    job: { ...jobBody, budget: { type: 'hourly', min: 30, max: 60, currency: 'USD' } },
    proposal: { ...proposalBody, bid: { amount: 45, type: 'hourly', currency: 'USD' }, milestones: [] },
    offer: { ...offerBody, budget: { amount: 45, type: 'hourly', currency: 'USD' }, milestones: [] },
  });
  const contract = await Contract.findById(hourly.accepted.contract).lean();
  assert.equal(contract.budget.type, 'hourly');
  assert.equal(contract.budget.amount, 45);
  assert.deepEqual(contract.milestones, []);
});

test('contract transitions enforce role rules, valid state changes, cancellation reasons, and audit history', async () => {
  const first = await acceptedContract('transitions', {
    job: { ...jobBody, budget: { type: 'hourly', min: 30, max: 60, currency: 'USD' } },
    proposal: { ...proposalBody, bid: { amount: 45, type: 'hourly', currency: 'USD' }, milestones: [] },
    offer: { ...offerBody, budget: { amount: 45, type: 'hourly', currency: 'USD' }, milestones: [] },
  });
  const contractId = first.accepted.contract;
  await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.freelancerToken)).send({ status: 'paused' }).expect(403);
  await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.clientToken)).send({ status: 'paused', note: 'Waiting for a required client asset.' }).expect(200);
  await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.freelancerToken)).send({ status: 'active' }).expect(403);
  await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.clientToken)).send({ status: 'active', note: 'Required asset delivered.' }).expect(200);
  const completed = await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.clientToken)).send({ status: 'completed', note: 'Delivery reviewed and accepted.' }).expect(200);
  assert.equal(completed.body.data.contract.status, 'completed');
  assert.equal(completed.body.data.contract.statusHistory.length, 4);
  await request(app).post(`/api/contracts/${contractId}/status`).set(auth(first.clientToken)).send({ status: 'cancelled', note: 'Too late' }).expect(400);

  const second = await acceptedContract('cancellation');
  await request(app).post(`/api/contracts/${second.accepted.contract}/status`).set(auth(second.freelancerToken)).send({ status: 'cancelled', note: '' }).expect(400);
  const cancelled = await request(app).post(`/api/contracts/${second.accepted.contract}/status`).set(auth(second.freelancerToken)).send({ status: 'cancelled', note: 'Unable to continue the engagement.' }).expect(200);
  assert.equal(cancelled.body.data.contract.status, 'cancelled');
  assert.equal(cancelled.body.data.contract.statusHistory.at(-1).actorRole, 'freelancer');
  assert.equal(cancelled.body.data.contract.statusHistory.at(-1).note, 'Unable to continue the engagement.');
});

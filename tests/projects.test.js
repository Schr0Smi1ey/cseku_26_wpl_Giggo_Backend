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
const { Notification } = await import('../src/models/Notification.js');
const { Offer } = await import('../src/models/Offer.js');
const { OfferRevision } = await import('../src/models/OfferRevision.js');
const { Project } = await import('../src/models/Project.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { User } = await import('../src/models/User.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown test token');
  return claims.get(token);
});

const app = createApp();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (id, role) => {
  const token = `project-token-${id}`;
  claims.set(token, {
    sub: id,
    email: `${id}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: id, signup_role: role },
  });
  return token;
};

const jobBody = {
  title: 'Build a project delivery workspace',
  description: 'Create a secure project delivery workspace with participant views, progress reporting, and audit history.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'fixed', min: 1000, max: 1400, currency: 'USD' },
};
const proposalBody = {
  coverLetter: 'I can deliver the project workspace with secure participant access, accessible screens, and tested progress reporting.',
  bid: { amount: 1200, type: 'fixed', currency: 'USD' },
  estimatedDays: 15,
  milestones: [{ title: 'Workspace delivery', amount: 1200, description: 'Workspace, tests, and documentation.' }],
};
const offerBody = {
  title: 'Project workspace delivery',
  description: 'Deliver the secure project workspace with participant views, progress reporting, tests, and documentation.',
  budget: { amount: 1200, type: 'fixed', currency: 'USD' },
  estimatedDays: 15,
  terms: 'Progress reports are operational updates and do not modify the accepted contract terms.',
  milestones: [{ title: 'Workspace delivery', amount: 1200, description: 'Workspace, tests, and documentation.' }],
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([
    Project.deleteMany({}),
    Contract.deleteMany({}),
    Message.deleteMany({}),
    Conversation.deleteMany({}),
    Notification.deleteMany({}),
    OfferRevision.deleteMany({}),
    Offer.deleteMany({}),
    Proposal.deleteMany({}),
    Job.deleteMany({}),
    User.deleteMany({}),
  ]);
});
after(async () => disconnectDB());

async function acceptedProject(suffix) {
  const clientToken = tokenFor(`project-client-${suffix}`, 'client');
  const freelancerToken = tokenFor(`project-freelancer-${suffix}`, 'freelancer');
  const outsiderToken = tokenFor(`project-outsider-${suffix}`, 'client');
  await request(app).get('/api/auth/me').set(auth(outsiderToken)).expect(200);
  const job = (await request(app).post('/api/jobs').set(auth(clientToken)).send(jobBody).expect(201)).body.data.job;
  const proposal = (await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody }).expect(201)).body.data.proposal;
  await request(app).post(`/api/proposals/${proposal._id}/decision`).set(auth(clientToken)).send({ decision: 'shortlist' }).expect(200);
  const offer = (await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...offerBody }).expect(201)).body.data.offer;
  await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  const accepted = (await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(200)).body.data.offer;
  const contract = await Contract.findById(accepted.contract).lean();
  const project = await Project.findOne({ contract: contract._id }).lean();
  return { clientToken, freelancerToken, outsiderToken, offer, contract, project };
}

test('accepted contracts create one participant-only project workspace with conversation access', async () => {
  const fixture = await acceptedProject('creation');
  assert.ok(fixture.project);
  assert.equal(String(fixture.contract.project), String(fixture.project._id));
  assert.equal(fixture.project.progress, 0);
  assert.equal(fixture.project.progressHistory.length, 1);

  const clientList = await request(app).get('/api/projects').set(auth(fixture.clientToken)).expect(200);
  assert.equal(clientList.body.data.items.length, 1);
  assert.equal(clientList.body.data.items[0].status, 'active');
  const freelancerView = await request(app).get(`/api/projects/${fixture.project._id}`).set(auth(fixture.freelancerToken)).expect(200);
  assert.ok(freelancerView.body.data.project.conversationId);
  await request(app).get(`/api/projects/${fixture.project._id}`).set(auth(fixture.outsiderToken)).expect(404);

  await request(app).post(`/api/offers/${fixture.offer._id}/accept`).set(auth(fixture.freelancerToken)).send({ revision: 1 }).expect(200);
  assert.equal(await Project.countDocuments({ contract: fixture.contract._id }), 1);
});

test('only the freelancer can report increasing progress while the contract is active', async () => {
  const fixture = await acceptedProject('progress');
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.clientToken)).send({ progress: 10, note: 'Client cannot report delivery progress.' }).expect(403);
  const updated = await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.freelancerToken)).send({ progress: 40, note: 'The core workspace screens and APIs are ready.' }).expect(200);
  assert.equal(updated.body.data.project.progress, 40);
  assert.equal(updated.body.data.project.progressHistory.length, 2);
  assert.equal(updated.body.data.project.progressHistory.at(-1).actorRole, 'freelancer');
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.freelancerToken)).send({ progress: 40, note: 'No actual progress change.' }).expect(400);
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.freelancerToken)).send({ progress: 30, note: 'Progress cannot move backwards.' }).expect(400);
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.outsiderToken)).send({ progress: 50, note: 'Outsider update attempt.' }).expect(404);

  const client = await User.findOne({ supabaseUserId: 'project-client-progress' });
  assert.equal(await Notification.countDocuments({ recipient: client._id, entityType: 'project', type: 'project_progress_updated' }), 1);
});

test('paused work blocks progress and client completion records 100 percent', async () => {
  const fixture = await acceptedProject('lifecycle');
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.freelancerToken)).send({ progress: 70, note: 'Implementation and integration are substantially complete.' }).expect(200);
  await request(app).post(`/api/contracts/${fixture.contract._id}/status`).set(auth(fixture.clientToken)).send({ status: 'paused', note: 'Waiting for final client assets.' }).expect(200);
  await request(app).patch(`/api/projects/${fixture.project._id}/progress`).set(auth(fixture.freelancerToken)).send({ progress: 80, note: 'This update must wait until work resumes.' }).expect(400);
  await request(app).post(`/api/contracts/${fixture.contract._id}/status`).set(auth(fixture.clientToken)).send({ status: 'active', note: 'Required assets are now available.' }).expect(200);
  await request(app).post(`/api/contracts/${fixture.contract._id}/status`).set(auth(fixture.clientToken)).send({ status: 'completed', note: 'Final delivery reviewed and accepted.' }).expect(200);

  const completed = await request(app).get(`/api/projects/${fixture.project._id}`).set(auth(fixture.clientToken)).expect(200);
  assert.equal(completed.body.data.project.status, 'completed');
  assert.equal(completed.body.data.project.progress, 100);
  assert.equal(completed.body.data.project.progressHistory.at(-1).actorRole, 'client');
});

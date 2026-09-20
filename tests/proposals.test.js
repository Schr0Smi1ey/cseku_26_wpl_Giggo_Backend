import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Job } = await import('../src/models/Job.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { SavedJob } = await import('../src/models/SavedJob.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { User } = await import('../src/models/User.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown token');
  return claims.get(token);
});

const app = createApp();
const tokenFor = (id, email, role) => {
  const token = `proposal-token-${id}`;
  claims.set(token, { sub: id, email, user_metadata: { name: id, signup_role: role } });
  return token;
};
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const jobBody = {
  title: 'Build a client reporting dashboard',
  description: 'Build a responsive reporting dashboard with charts, filtering, and accessible interaction states.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'fixed', min: 500, max: 900, currency: 'USD' },
};
const proposalBody = {
  coverLetter: 'I can build this reporting dashboard with reusable React components, accessible interaction states, and a tested API integration. I will begin with the data contract and deliver the work in reviewable increments.',
  bid: { amount: 720, type: 'fixed', currency: 'bdt' },
  estimatedDays: 14,
  milestones: [
    { title: 'Dashboard foundation', amount: 320, description: 'Layout, routing, and reusable chart components.' },
    { title: 'Integration and delivery', amount: 400, dueDate: '2026-12-15', description: 'API integration, testing, and final handoff.' },
  ],
  aiAssisted: true,
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([Proposal.deleteMany({}), SavedJob.deleteMany({}), FreelancerProfile.deleteMany({}), Job.deleteMany({}), User.deleteMany({})]);
});
after(async () => disconnectDB());

async function provision(token) {
  const response = await request(app).get('/api/auth/me').set(auth(token)).expect(200);
  return response.body.data.user;
}

async function createJob(clientToken, overrides = {}) {
  const response = await request(app).post('/api/jobs').set(auth(clientToken)).send({ ...jobBody, ...overrides }).expect(201);
  return response.body.data.job;
}

test('a freelancer can submit one validated proposal and retrieve its job-specific status', async () => {
  const clientToken = tokenFor('proposal-client-1', 'proposal-client-1@example.test', 'client');
  const freelancerToken = tokenFor('proposal-freelancer-1', 'proposal-freelancer-1@example.test', 'freelancer');
  const job = await createJob(clientToken);
  const freelancer = await provision(freelancerToken);

  const response = await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: job._id, ...proposalBody })
    .expect(201);

  const proposal = response.body.data.proposal;
  assert.equal(proposal.job, job._id);
  assert.equal(proposal.freelancer, freelancer._id);
  assert.equal(proposal.client, job.client);
  assert.equal(proposal.bid.currency, 'BDT');
  assert.equal(proposal.status, 'submitted');
  assert.equal(proposal.milestones.length, 2);
  assert.equal(proposal.aiAssisted, true);

  const status = await request(app)
    .get(`/api/proposals/jobs/${job._id}/mine`)
    .set(auth(freelancerToken))
    .expect(200);
  assert.equal(status.body.data.proposal._id, proposal._id);
  assert.equal(status.body.data.proposal.status, 'submitted');

  const duplicate = await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: job._id, ...proposalBody })
    .expect(409);
  assert.equal(duplicate.body.message, 'You have already submitted a proposal for this job');
  assert.equal(await Proposal.countDocuments({ job: job._id, freelancer: freelancer._id }), 1);

  await request(app).post(`/api/jobs/${job._id}/save`).set(auth(freelancerToken)).expect(200);
  const personalized = await request(app).get('/api/jobs').set(auth(freelancerToken)).expect(200);
  assert.equal(personalized.body.data.items[0].viewerState.applied, true);
  assert.equal(personalized.body.data.items[0].viewerState.proposalStatus, 'submitted');
  assert.equal(personalized.body.data.items[0].viewerState.followed, true);

  await request(app).patch(`/api/jobs/${job._id}`).set(auth(clientToken)).send({ status: 'closed' }).expect(200);
  await request(app).get('/api/jobs').set(auth(freelancerToken)).expect(200).expect((res) => assert.equal(res.body.data.items.length, 0));
  await request(app).get('/api/jobs?activity=applied').set(auth(freelancerToken)).expect(200).expect((res) => {
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0]._id, job._id);
    assert.equal(res.body.data.items[0].viewerState.applied, true);
  });
  await request(app).get('/api/jobs?activity=followed').set(auth(freelancerToken)).expect(200).expect((res) => {
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].viewerState.followed, true);
  });
  await request(app).get(`/api/jobs/${job._id}`).set(auth(freelancerToken)).expect(200);
  await request(app).get('/api/jobs?activity=applied').expect(401);
  await request(app).get('/api/jobs?activity=applied').set(auth(clientToken)).expect(403);
});

test('concurrent proposal submissions preserve one proposal per freelancer and job', async () => {
  const clientToken = tokenFor('proposal-client-concurrent', 'proposal-client-concurrent@example.test', 'client');
  const freelancerToken = tokenFor('proposal-freelancer-concurrent', 'proposal-freelancer-concurrent@example.test', 'freelancer');
  const job = await createJob(clientToken);
  const freelancer = await provision(freelancerToken);
  const submit = () => request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody });

  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await Proposal.countDocuments({ job: job._id, freelancer: freelancer._id }), 1);
});

test('proposal submission enforces authentication, role, ownership, job status, and body validation', async () => {
  const clientToken = tokenFor('proposal-client-2', 'proposal-client-2@example.test', 'client');
  const freelancerToken = tokenFor('proposal-freelancer-2', 'proposal-freelancer-2@example.test', 'freelancer');
  const job = await createJob(clientToken);
  const freelancer = await provision(freelancerToken);

  await request(app).post('/api/proposals').send({ job: job._id, ...proposalBody }).expect(401);
  await request(app).post('/api/proposals').set(auth(clientToken)).send({ job: job._id, ...proposalBody }).expect(403);
  await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, coverLetter: 'Too short' }).expect(400);

  const closedJob = await Job.create({ ...jobBody, client: job.client, status: 'closed' });
  await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: String(closedJob._id), ...proposalBody })
    .expect(400);

  const ownJob = await Job.create({ ...jobBody, title: 'A freelancer-owned test job', client: freelancer._id });
  await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: String(ownJob._id), ...proposalBody })
    .expect(400);

  await request(app).get('/api/proposals/jobs/not-an-id/mine').set(auth(freelancerToken)).expect(400);
  assert.equal(await Proposal.countDocuments({}), 0);
});

test('deleting a job also removes its proposals', async () => {
  const clientToken = tokenFor('proposal-client-3', 'proposal-client-3@example.test', 'client');
  const freelancerToken = tokenFor('proposal-freelancer-3', 'proposal-freelancer-3@example.test', 'freelancer');
  const job = await createJob(clientToken);
  await provision(freelancerToken);

  await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody }).expect(201);
  assert.equal(await Proposal.countDocuments({ job: job._id }), 1);
  await request(app).delete(`/api/jobs/${job._id}`).set(auth(clientToken)).expect(200);
  assert.equal(await Proposal.countDocuments({ job: job._id }), 0);
});

test('freelancers manage proposals while job owners privately review and decide them', async () => {
  const clientToken = tokenFor('proposal-client-manage', 'proposal-client-manage@example.test', 'client');
  const freelancerToken = tokenFor('proposal-freelancer-manage', 'proposal-freelancer-manage@example.test', 'freelancer');
  const outsiderToken = tokenFor('proposal-outsider', 'proposal-outsider@example.test', 'freelancer');
  const outsiderClientToken = tokenFor('proposal-outsider-client', 'proposal-outsider-client@example.test', 'client');
  const job = await createJob(clientToken);
  const freelancer = await provision(freelancerToken);
  await provision(outsiderToken);
  await provision(outsiderClientToken);
  await FreelancerProfile.create({
    user: freelancer._id,
    title: 'React developer',
    skills: ['React', 'Node.js'],
    hourlyRate: 35,
    visibility: 'public',
  });

  const created = await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: job._id, ...proposalBody })
    .expect(201);
  const proposalId = created.body.data.proposal._id;

  const mine = await request(app).get('/api/proposals/mine?status=submitted').set(auth(freelancerToken)).expect(200);
  assert.equal(mine.body.data.pagination.total, 1);
  assert.equal(mine.body.data.items[0].job.title, job.title);
  await request(app).get('/api/proposals/mine').set(auth(clientToken)).expect(403);

  const received = await request(app).get(`/api/proposals/received?job=${job._id}`).set(auth(clientToken)).expect(200);
  assert.equal(received.body.data.pagination.total, 1);
  assert.equal(received.body.data.items[0].freelancerProfile.title, 'React developer');
  const publicProfile = await request(app).get(`/api/profiles/${freelancer._id}`).expect(200);
  assert.equal(publicProfile.body.data.profile.title, 'React developer');
  await request(app).get('/api/proposals/received').set(auth(freelancerToken)).expect(403);

  await request(app).get(`/api/proposals/${proposalId}`).set(auth(outsiderToken)).expect(404);
  await request(app).post(`/api/proposals/${proposalId}/withdraw`).set(auth(outsiderToken)).expect(404);
  await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(outsiderClientToken))
    .send({ decision: 'shortlist' })
    .expect(404);
  const detail = await request(app).get(`/api/proposals/${proposalId}`).set(auth(clientToken)).expect(200);
  assert.equal(detail.body.data.proposal.freelancerProfile.title, 'React developer');
  assert.ok(detail.body.data.proposal.viewedAt);

  const revisedLetter = `${proposalBody.coverLetter} I will also provide concise setup documentation and a final walkthrough.`;
  const revised = await request(app)
    .patch(`/api/proposals/${proposalId}`)
    .set(auth(freelancerToken))
    .send({ coverLetter: revisedLetter, bid: { amount: 760, type: 'fixed', currency: 'USD' } })
    .expect(200);
  assert.equal(revised.body.data.proposal.bid.amount, 760);
  await request(app).patch(`/api/proposals/${proposalId}`).set(auth(clientToken)).send({ coverLetter: revisedLetter }).expect(403);
  await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'reconsider' })
    .expect(400);

  const shortlisted = await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'shortlist', reviewNote: 'Strong relevant experience.' })
    .expect(200);
  assert.equal(shortlisted.body.data.proposal.status, 'shortlisted');
  assert.equal(shortlisted.body.data.proposal.reviewNote, 'Strong relevant experience.');

  const rejected = await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'reject', reviewNote: 'The delivery window changed.' })
    .expect(200);
  assert.equal(rejected.body.data.proposal.status, 'rejected');
  await request(app).patch(`/api/proposals/${proposalId}`).set(auth(freelancerToken)).send({ coverLetter: revisedLetter }).expect(400);

  const reconsidered = await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'reconsider' })
    .expect(200);
  assert.equal(reconsidered.body.data.proposal.status, 'submitted');

  const withdrawn = await request(app).post(`/api/proposals/${proposalId}/withdraw`).set(auth(freelancerToken)).expect(200);
  assert.equal(withdrawn.body.data.proposal.status, 'withdrawn');
  assert.ok(withdrawn.body.data.proposal.withdrawnAt);
  await request(app)
    .post(`/api/proposals/${proposalId}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'shortlist' })
    .expect(400);

  const reapplied = await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: job._id, ...proposalBody })
    .expect(201);
  assert.equal(reapplied.body.data.proposal._id, proposalId);
  assert.equal(reapplied.body.data.proposal.status, 'submitted');
  assert.equal(await Proposal.countDocuments({ job: job._id, freelancer: freelancer._id }), 1);

  await request(app).patch(`/api/jobs/${job._id}`).set(auth(clientToken)).send({ status: 'closed' }).expect(200);
  await request(app).patch(`/api/proposals/${proposalId}`).set(auth(freelancerToken)).send({ coverLetter: revisedLetter }).expect(400);
});

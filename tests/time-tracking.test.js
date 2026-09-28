import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { ActiveTimer } = await import('../src/models/ActiveTimer.js');
const { Contract } = await import('../src/models/Contract.js');
const { Conversation } = await import('../src/models/Conversation.js');
const { Job } = await import('../src/models/Job.js');
const { Message } = await import('../src/models/Message.js');
const { Milestone } = await import('../src/models/Milestone.js');
const { Notification } = await import('../src/models/Notification.js');
const { Offer } = await import('../src/models/Offer.js');
const { OfferRevision } = await import('../src/models/OfferRevision.js');
const { Project } = await import('../src/models/Project.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { TimeEntry } = await import('../src/models/TimeEntry.js');
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
const tokenFor = (identity, role) => {
  const token = `time-token-${identity}`;
  claims.set(token, {
    sub: identity,
    email: `${identity}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: identity, signup_role: role },
  });
  return token;
};

const jobBody = {
  title: 'Build an hourly analytics dashboard',
  description: 'Build and test an hourly analytics dashboard with secure data access, responsive screens, and clear documentation.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'hourly', min: 40, max: 60, currency: 'USD' },
};
const proposalBody = {
  coverLetter: 'I can build the analytics dashboard through traceable hourly work with secure implementation and reliable tests.',
  bid: { amount: 50, type: 'hourly', currency: 'USD' },
  estimatedDays: 20,
  milestones: [],
};
const offerBody = {
  title: 'Hourly analytics dashboard development',
  description: 'Build the secure analytics dashboard, responsive interfaces, automated checks, and concise implementation documentation.',
  budget: { amount: 50, type: 'hourly', currency: 'USD' },
  estimatedDays: 20,
  terms: 'Record meaningful descriptions for all billable work and keep time entries accurate.',
  milestones: [],
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([
    ActiveTimer.deleteMany({}),
    TimeEntry.deleteMany({}),
    WorkSubmission.deleteMany({}),
    Milestone.deleteMany({}),
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

async function acceptedProject(suffix, { fixed = false } = {}) {
  const clientToken = tokenFor(`time-client-${suffix}`, 'client');
  const freelancerToken = tokenFor(`time-freelancer-${suffix}`, 'freelancer');
  const outsiderToken = tokenFor(`time-outsider-${suffix}`, 'client');
  await request(app).get('/api/auth/me').set(auth(outsiderToken)).expect(200);
  const jobValues = fixed
    ? { ...jobBody, budget: { type: 'fixed', min: 1000, max: 1000, currency: 'USD' } }
    : jobBody;
  const proposalValues = fixed
    ? { ...proposalBody, bid: { amount: 1000, type: 'fixed', currency: 'USD' }, milestones: [{ title: 'Delivery', amount: 1000 }] }
    : proposalBody;
  const offerValues = fixed
    ? { ...offerBody, budget: { amount: 1000, type: 'fixed', currency: 'USD' }, milestones: [{ title: 'Delivery', amount: 1000 }] }
    : offerBody;
  const job = (await request(app).post('/api/jobs').set(auth(clientToken)).send(jobValues).expect(201)).body.data.job;
  const proposal = (await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalValues }).expect(201)).body.data.proposal;
  await request(app).post(`/api/proposals/${proposal._id}/decision`).set(auth(clientToken)).send({ decision: 'shortlist' }).expect(200);
  const offer = (await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...offerValues }).expect(201)).body.data.offer;
  await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  const accepted = (await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(200)).body.data.offer;
  const contract = await Contract.findById(accepted.contract);
  const project = await Project.findOne({ contract: contract._id });
  return { clientToken, freelancerToken, outsiderToken, contract, project };
}

test('work diary is participant-only and available only to hourly projects', async () => {
  const hourly = await acceptedProject('privacy');
  await request(app).get(`/api/projects/${hourly.project._id}/time`).set(auth(hourly.clientToken)).expect(200);
  await request(app).get(`/api/projects/${hourly.project._id}/time`).set(auth(hourly.freelancerToken)).expect(200);
  await request(app).get(`/api/projects/${hourly.project._id}/time`).set(auth(hourly.outsiderToken)).expect(404);

  const fixed = await acceptedProject('fixed', { fixed: true });
  await request(app).get(`/api/projects/${fixed.project._id}/time`).set(auth(fixed.freelancerToken)).expect(400);
});

test('freelancer timer uses heartbeats, prevents concurrent timers, and stops idempotently', async () => {
  const fixture = await acceptedProject('timer');
  const base = `/api/projects/${fixture.project._id}/time`;
  const payload = { description: 'Implement the authenticated analytics query and result cards.', idempotencyKey: 'timer-start-request-1' };

  await request(app).post(`${base}/timers`).set(auth(fixture.clientToken)).send(payload).expect(403);
  const started = await request(app).post(`${base}/timers`).set(auth(fixture.freelancerToken)).send(payload).expect(201);
  const timerId = started.body.data.timer._id;
  const retry = await request(app).post(`${base}/timers`).set(auth(fixture.freelancerToken)).send(payload).expect(201);
  assert.equal(retry.body.data.timer._id, timerId);
  await request(app).post(`${base}/timers`).set(auth(fixture.freelancerToken)).send({ ...payload, idempotencyKey: 'timer-start-request-2' }).expect(409);
  await request(app).post(`${base}/timers/${timerId}/heartbeat`).set(auth(fixture.freelancerToken)).expect(200);

  const startedAt = new Date(Date.now() - 30 * 60 * 1000);
  await ActiveTimer.updateOne({ _id: timerId }, { $set: { startedAt, lastHeartbeatAt: new Date() } });
  const stopped = await request(app).post(`${base}/timers/${timerId}/stop`).set(auth(fixture.freelancerToken)).send({}).expect(200);
  const entry = stopped.body.data.entry;
  assert.equal(entry.source, 'timer');
  assert.equal(entry.durationMinutes, 30);
  assert.equal(entry.hourlyRate, 50);
  assert.equal(entry.estimatedAmount, 25);
  const stopRetry = await request(app).post(`${base}/timers/${timerId}/stop`).set(auth(fixture.freelancerToken)).send({}).expect(200);
  assert.equal(stopRetry.body.data.entry._id, entry._id);
  assert.equal(await TimeEntry.countDocuments({ timer: timerId }), 1);

  const clientDiary = await request(app).get(base).set(auth(fixture.clientToken)).expect(200);
  assert.equal(clientDiary.body.data.activeTimer, null);
  assert.equal(clientDiary.body.data.summary.totalMinutes, 30);
  assert.equal(clientDiary.body.data.summary.estimatedAmount, 25);
  const client = await User.findOne({ supabaseUserId: 'time-client-timer' });
  assert.equal(await Notification.countDocuments({ recipient: client._id, type: 'hourly_time_recorded' }), 1);
});

test('manual entries validate ranges and overlaps, preserve revisions, and soft-delete', async () => {
  const fixture = await acceptedProject('manual');
  await Contract.updateOne({ _id: fixture.contract._id }, { $set: { activatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
  const base = `/api/projects/${fixture.project._id}/time`;
  const endedAt = new Date(Date.now() - 60 * 60 * 1000);
  const startedAt = new Date(endedAt.getTime() - 60 * 60 * 1000);
  const createPayload = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    description: 'Built and tested the dashboard filtering controls.',
    idempotencyKey: 'manual-time-request-1',
  };
  const created = await request(app).post(`${base}/entries`).set(auth(fixture.freelancerToken)).send(createPayload).expect(201);
  const entry = created.body.data.entry;
  assert.equal(entry.durationMinutes, 60);
  assert.equal(entry.estimatedAmount, 50);
  const retry = await request(app).post(`${base}/entries`).set(auth(fixture.freelancerToken)).send(createPayload).expect(201);
  assert.equal(retry.body.data.entry._id, entry._id);
  await request(app).post(`${base}/entries`).set(auth(fixture.freelancerToken)).send({
    ...createPayload,
    startedAt: new Date(startedAt.getTime() + 30 * 60 * 1000).toISOString(),
    endedAt: new Date(endedAt.getTime() + 30 * 60 * 1000).toISOString(),
    idempotencyKey: 'manual-time-request-2',
  }).expect(409);
  await request(app).post(`${base}/entries`).set(auth(fixture.freelancerToken)).send({
    ...createPayload,
    startedAt: new Date(Date.now() + 60_000).toISOString(),
    endedAt: new Date(Date.now() + 120_000).toISOString(),
    idempotencyKey: 'manual-time-request-3',
  }).expect(400);

  await request(app).patch(`${base}/entries/${entry._id}`).set(auth(fixture.clientToken)).send({ revision: 1, reason: 'Client cannot edit.', description: 'No.' }).expect(403);
  const updated = await request(app).patch(`${base}/entries/${entry._id}`).set(auth(fixture.freelancerToken)).send({
    revision: 1,
    reason: 'Clarified the completed task.',
    description: 'Built, tested, and documented the dashboard filtering controls.',
  }).expect(200);
  assert.equal(updated.body.data.entry.revision, 2);
  assert.equal(updated.body.data.entry.revisions.length, 1);
  assert.equal(updated.body.data.entry.revisions[0].previous.description, createPayload.description);
  await request(app).patch(`${base}/entries/${entry._id}`).set(auth(fixture.freelancerToken)).send({
    revision: 1,
    reason: 'Stale update attempt.',
    description: 'This must not overwrite the current entry.',
  }).expect(409);

  const deleted = await request(app).delete(`${base}/entries/${entry._id}`).set(auth(fixture.freelancerToken)).send({
    revision: 2,
    reason: 'The work was entered against the wrong period.',
  }).expect(200);
  assert.equal(deleted.body.data.entry.status, 'deleted');
  assert.equal(deleted.body.data.entry.revision, 3);
  assert.equal(deleted.body.data.entry.revisions.length, 2);
  const diary = await request(app).get(base).set(auth(fixture.clientToken)).expect(200);
  assert.equal(diary.body.data.items.length, 1);
  assert.equal(diary.body.data.items[0].status, 'deleted');
  assert.equal(diary.body.data.summary.totalMinutes, 0);
});

test('paused contracts reject timer and manual time writes', async () => {
  const fixture = await acceptedProject('paused');
  const base = `/api/projects/${fixture.project._id}/time`;
  const running = await request(app).post(`${base}/timers`).set(auth(fixture.freelancerToken)).send({
    description: 'Work started before the client paused the contract.',
    idempotencyKey: 'pre-pause-timer-request',
  }).expect(201);
  await request(app).post(`/api/contracts/${fixture.contract._id}/status`).set(auth(fixture.clientToken)).send({ status: 'paused', note: 'Work is temporarily paused.' }).expect(200);
  await request(app).post(`${base}/timers/${running.body.data.timer._id}/heartbeat`).set(auth(fixture.freelancerToken)).expect(400);
  await request(app).post(`${base}/timers/${running.body.data.timer._id}/stop`).set(auth(fixture.freelancerToken)).send({}).expect(200);
  await request(app).post(`${base}/timers`).set(auth(fixture.freelancerToken)).send({
    description: 'This timer must not start while paused.',
    idempotencyKey: 'paused-timer-request',
  }).expect(400);
  const endedAt = new Date(Date.now() - 60_000);
  await request(app).post(`${base}/entries`).set(auth(fixture.freelancerToken)).send({
    startedAt: new Date(endedAt.getTime() - 60_000).toISOString(),
    endedAt: endedAt.toISOString(),
    description: 'This manual entry must not save while paused.',
    idempotencyKey: 'paused-manual-request',
  }).expect(400);
});

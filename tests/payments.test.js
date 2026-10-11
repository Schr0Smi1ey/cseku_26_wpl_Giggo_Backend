import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const mongoose = (await import('mongoose')).default;
const { Contract } = await import('../src/models/Contract.js');
const { Milestone } = await import('../src/models/Milestone.js');
const { Notification } = await import('../src/models/Notification.js');
const { Payment } = await import('../src/models/Payment.js');
const { PaymentTransaction } = await import('../src/models/PaymentTransaction.js');
const { Project } = await import('../src/models/Project.js');
const { Transaction } = await import('../src/models/Transaction.js');
const { User } = await import('../src/models/User.js');
const { VirtualCard } = await import('../src/models/VirtualCard.js');
const { Wallet } = await import('../src/models/Wallet.js');
const { WalletLedgerEntry } = await import('../src/models/WalletLedgerEntry.js');
const { paymentService } = await import('../src/services/payment.service.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown test token');
  return claims.get(token);
});

const app = createApp();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (id, role) => {
  const token = `payment-token-${id}`;
  claims.set(token, {
    sub: id,
    email: `${id}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: id, signup_role: role },
  });
  return token;
};

const jobBody = {
  title: 'Build a payment protected workspace',
  description: 'Create a secure workspace where milestone payments are held in escrow until the client approves delivery.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'fixed', min: 1000, max: 1400, currency: 'USD' },
};
const milestoneTerms = [{ title: 'Workspace delivery', amount: 1200, description: 'Workspace, tests, and documentation.' }];
const proposalBody = {
  coverLetter: 'I can deliver the workspace with escrow-aware milestones, accessible screens, and thorough automated tests.',
  bid: { amount: 1200, type: 'fixed', currency: 'USD' },
  estimatedDays: 15,
  milestones: milestoneTerms,
};
const offerBody = {
  title: 'Payment protected delivery',
  description: 'Deliver the workspace with escrow funded milestones, client review, and release after approval.',
  budget: { amount: 1200, type: 'fixed', currency: 'USD' },
  estimatedDays: 15,
  terms: 'Each milestone is funded into escrow before work starts.',
  milestones: milestoneTerms,
};

before(async () => {
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
beforeEach(async () => {
  claims.clear();
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});
after(async () => disconnectDB());

const reload = (token, key, body) => request(app).post('/api/wallet/reload').set(auth(token)).set('Idempotency-Key', key).send(body);
const activateCard = (token, key) => reload(token, key, { amount: 500, provider: 'BKASH_SIMULATED' }).expect(201);

async function acceptedProject(suffix) {
  const clientToken = tokenFor(`pay-client-${suffix}`, 'client');
  const freelancerToken = tokenFor(`pay-freelancer-${suffix}`, 'freelancer');
  const otherClientToken = tokenFor(`pay-other-${suffix}`, 'client');
  await request(app).get('/api/auth/me').set(auth(otherClientToken)).expect(200);
  // Clients load the same wallet that will be debited into milestone escrow.
  await reload(clientToken, `client-funds-${suffix}`, { amount: 1200, provider: 'BKASH_SIMULATED' }).expect(201);
  await activateCard(freelancerToken, `activate-${suffix}`);
  const job = (await request(app).post('/api/jobs').set(auth(clientToken)).send(jobBody).expect(201)).body.data.job;
  const proposal = (await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody }).expect(201)).body.data.proposal;
  await request(app).post(`/api/proposals/${proposal._id}/decision`).set(auth(clientToken)).send({ decision: 'shortlist' }).expect(200);
  const offer = (await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...offerBody }).expect(201)).body.data.offer;
  await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  const accepted = (await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(200)).body.data.offer;
  const contract = await Contract.findById(accepted.contract).lean();
  const project = await Project.findOne({ contract: contract._id }).lean();
  const milestone = await Milestone.findOne({ project: project._id }).lean();
  const client = await User.findOne({ supabaseUserId: `pay-client-${suffix}` });
  const freelancer = await User.findOne({ supabaseUserId: `pay-freelancer-${suffix}` });
  return { clientToken, freelancerToken, otherClientToken, contract, project, milestone, client, freelancer };
}

// The payment worker advances checkout -> processing -> settled; make each step due immediately.
async function settle(paymentId) {
  await Payment.updateOne({ _id: paymentId }, { $set: { processAfter: new Date(0) } });
  await paymentService.processPending();
  assert.equal((await Payment.findById(paymentId)).status, 'processing');
  await Payment.updateOne({ _id: paymentId }, { $set: { processAfter: new Date(0) } });
  await paymentService.processPending();
  return Payment.findById(paymentId);
}

const fund = (token, milestoneId, key, body = {}) => request(app).post(`/api/milestones/${milestoneId}/fund`).set(auth(token)).set('Idempotency-Key', key).send(body);

test('virtual card starts inactive and masked, reloads idempotently and activates at the minimum', async () => {
  const token = tokenFor('card-dev', 'freelancer');
  const card = (await request(app).get('/api/cards/me').set(auth(token)).expect(200)).body.data.card;
  assert.equal(card.status, 'inactive');
  assert.equal(card.balance, 0);
  assert.match(card.maskedCardNumber, /^4928 \*\*\*\* \*\*\*\* \d{4}$/);
  assert.equal(card.cardNumberHash, undefined);

  const failed = (await reload(token, 'k-failed', { amount: 500, provider: 'NAGAD_SIMULATED', outcome: 'failed' }).expect(201)).body.data;
  assert.equal(failed.payment.status, 'failed');
  assert.equal(failed.card.balance, 0);

  const first = (await reload(token, 'k-1', { amount: 300, provider: 'BKASH_SIMULATED' }).expect(201)).body.data;
  assert.equal(first.card.balance, 300);
  assert.equal(first.card.status, 'inactive');
  const duplicate = (await reload(token, 'k-1', { amount: 300, provider: 'BKASH_SIMULATED' }).expect(201)).body.data;
  assert.equal(duplicate.card.balance, 300);
  const second = (await reload(token, 'k-2', { amount: 200, provider: 'ROCKET_SIMULATED' }).expect(201)).body.data;
  assert.equal(second.card.balance, 500);
  assert.equal(second.card.status, 'active');
  assert.equal(await WalletLedgerEntry.countDocuments({ type: 'card_reload' }), 2);

  await request(app).post('/api/wallet/reload').set(auth(token)).send({ amount: 100, provider: 'BKASH_SIMULATED' }).expect(400);
  await request(app).post('/api/wallet/reload').set(auth(token)).set('Idempotency-Key', 'k-bad').send({ amount: 100, provider: 'VISA' }).expect(400);

  const frozen = (await request(app).post('/api/cards/freeze').set(auth(token)).expect(200)).body.data.card;
  assert.equal(frozen.status, 'suspended');
  const blocked = (await request(app).get('/api/developers/me/eligibility').set(auth(token)).expect(200)).body.data;
  assert.equal(blocked.canApplyForJobs, false);
  assert.equal(blocked.reason, 'CARD_SUSPENDED');
  assert.equal((await request(app).post('/api/cards/unfreeze').set(auth(token)).expect(200)).body.data.card.status, 'active');
});

test('clients and freelancers can reload cards, while only freelancers need an active card for proposals', async () => {
  const clientToken = tokenFor('card-client', 'client');
  const freelancerToken = tokenFor('card-gate', 'freelancer');
  const clientReload = (await request(app).post('/api/wallet/reload').set(auth(clientToken)).set('Idempotency-Key', 'c-1').send({ amount: 500, provider: 'BKASH_SIMULATED' }).expect(201)).body.data;
  assert.equal(clientReload.card.balance, 500);
  await request(app).get('/api/developers/me/eligibility').set(auth(clientToken)).expect(403);
  await request(app).get('/api/cards/me').expect(401);

  const job = (await request(app).post('/api/jobs').set(auth(clientToken)).send(jobBody).expect(201)).body.data.job;
  const blocked = await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody }).expect(403);
  assert.equal(blocked.body.error.code, 'CARD_ACTIVATION_REQUIRED');
  assert.equal(blocked.body.error.details.amountRequired, 500);

  await activateCard(freelancerToken, 'gate-activate');
  await request(app).post('/api/proposals').set(auth(freelancerToken)).send({ job: job._id, ...proposalBody }).expect(201);
});

test('milestone escrow: fund, settle, work, approve and a single concurrent release', async () => {
  const f = await acceptedProject('flow');
  const base = `/api/projects/${f.project._id}/milestones/${f.milestone._id}`;

  const response = await fund(f.clientToken, f.milestone._id, 'flow-key', { provider: 'NAGAD_SIMULATED', amount: 1, developerId: f.client._id }).expect(202);
  const queued = response.body.data.payment;
  assert.equal(queued.status, 'checkout_created');
  assert.equal(queued.amount, 1200);
  assert.equal(queued.simulationOutcome, undefined);
  assert.equal(queued.freelancerAmount, undefined);
  assert.equal((await Milestone.findById(f.milestone._id)).status, 'funding_pending');
  await request(app).post(`${base}/start`).set(auth(f.freelancerToken)).expect(400);

  const done = await settle(queued._id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.freelancerAmount, 1080);
  assert.equal(done.platformFee, 120);
  assert.equal((await Milestone.findById(f.milestone._id)).status, 'funded');
  assert.equal((await VirtualCard.findOne({ user: f.client._id })).heldBalance, 1200);
  assert.equal(await Transaction.countDocuments({ payment: done._id, type: 'escrow_funding' }), 1);
  assert.equal(await Notification.countDocuments({ entityId: done._id, type: 'escrow_funded' }), 2);

  await request(app).post(`/api/milestones/${f.milestone._id}/release`).set(auth(f.clientToken)).expect(400);
  await request(app).post(`${base}/start`).set(auth(f.freelancerToken)).expect(200);
  const submitted = await request(app).post(`${base}/submissions`).set(auth(f.freelancerToken)).send({ description: 'Escrow-backed delivery is ready for review.', links: [] }).expect(200);
  const submissionId = submitted.body.data.project.milestones[0].submissions[0]._id;
  await request(app).post(`${base}/submissions/${submissionId}/review`).set(auth(f.clientToken)).send({ decision: 'approve' }).expect(200);

  await request(app).post(`/api/milestones/${f.milestone._id}/release`).set(auth(f.freelancerToken)).expect(403);
  const releases = await Promise.all([
    request(app).post(`/api/milestones/${f.milestone._id}/release`).set(auth(f.clientToken)),
    request(app).post(`/api/milestones/${f.milestone._id}/release`).set(auth(f.clientToken)),
  ]);
  assert.ok(releases.every((r) => r.status === 200), JSON.stringify(releases.map((r) => r.body)));
  assert.equal(await Transaction.countDocuments({ payment: done._id, type: 'escrow_release' }), 1);
  assert.equal((await VirtualCard.findOne({ user: f.freelancer._id })).balance, 500 + 1080);
  assert.equal((await VirtualCard.findOne({ user: f.client._id })).heldBalance, 0);
  assert.equal(await WalletLedgerEntry.countDocuments({ referenceId: done._id, type: 'developer_earning' }), 1);
  assert.equal((await Wallet.findOne({ user: f.freelancer._id })).totalEarned, 1080);
  assert.equal((await Milestone.findById(f.milestone._id)).status, 'paid');
  assert.equal((await Payment.findById(done._id)).escrowStatus, 'released');

  const workspace = (await request(app).get(`/api/projects/${f.project._id}`).set(auth(f.clientToken)).expect(200)).body.data.project;
  assert.equal(workspace.financialSummary.released, 1200);
  assert.equal(workspace.financialSummary.escrow, 0);
  assert.equal(workspace.financialSummary.remaining, 0);
  assert.equal(workspace.payments.length, 1);
  assert.equal(workspace.payments[0].freelancerAmount, undefined);

  // A paid milestone counts as finished, so the client can complete the contract.
  await request(app).post(`/api/contracts/${f.contract._id}/status`).set(auth(f.clientToken)).send({ status: 'completed', note: 'Delivered and paid.' }).expect(200);

  const details = (await request(app).get(`/api/payments/${done._id}`).set(auth(f.freelancerToken)).expect(200)).body.data.payment;
  assert.equal(details.attempts.length, 1);
  const history = (await request(app).get('/api/payments').set(auth(f.clientToken)).expect(200)).body.data.payments;
  assert.equal(history.length, 1);
});

test('provider failure, safe retry, duplicate requests, key reuse and unauthorized access', async () => {
  const f = await acceptedProject('retry');
  const other = await acceptedProject('retry-other');

  const failedPayment = (await fund(f.clientToken, f.milestone._id, 'fail-key', { provider: 'NAGAD_SIMULATED', outcome: 'failed' }).expect(202)).body.data.payment;
  const failed = await settle(failedPayment._id);
  assert.equal(failed.status, 'failed');
  assert.equal((await Milestone.findById(f.milestone._id)).status, 'pending');
  assert.equal(await WalletLedgerEntry.countDocuments({ referenceId: failed._id }), 0);
  assert.equal((await VirtualCard.findOne({ user: f.client._id })).heldBalance, 0);

  await fund(other.clientToken, f.milestone._id, 'steal-key').expect(403);
  await request(app).post(`/api/milestones/${f.milestone._id}/fund`).set(auth(f.freelancerToken)).set('Idempotency-Key', 'dev-key').send({}).expect(403);
  await fund(f.clientToken, f.milestone._id, '').expect(400);
  await request(app).get(`/api/payments/${failed._id}`).set(auth(other.clientToken)).expect(404);
  await fund(other.clientToken, other.milestone._id, 'fail-key').expect(409);
  await request(app).post('/api/milestones/not-an-id/fund').set(auth(f.clientToken)).set('Idempotency-Key', 'x').send({}).expect(400);

  const retried = await Promise.all(Array.from({ length: 4 }, () => paymentService.fundMilestone(f.client, f.milestone._id, 'retry-key', 'ROCKET_SIMULATED')));
  assert.ok(retried.every((payment) => String(payment._id) === String(failed._id)));
  const succeeded = await settle(retried[0]._id);
  assert.equal(succeeded.status, 'succeeded');
  assert.equal(await Payment.countDocuments({ milestone: f.milestone._id }), 1);
  assert.equal(await PaymentTransaction.countDocuments({ milestoneId: f.milestone._id }), 2);
  assert.equal(await Transaction.countDocuments({ payment: succeeded._id, type: 'escrow_funding' }), 1);

  const duplicate = await paymentService.fundMilestone(f.client, f.milestone._id, 'another-key');
  assert.equal(duplicate.status, 'succeeded');
  assert.equal(await PaymentTransaction.countDocuments({ milestoneId: f.milestone._id }), 2);
});

test('release rolls back atomically when the developer card is missing', async () => {
  const f = await acceptedProject('rollback');
  const payment = (await fund(f.clientToken, f.milestone._id, 'rollback-key').expect(202)).body.data.payment;
  await settle(payment._id);
  await Milestone.updateOne({ _id: f.milestone._id }, { $set: { status: 'approved' } });
  await VirtualCard.deleteOne({ user: f.freelancer._id });
  await assert.rejects(paymentService.release(f.client, f.milestone._id), /card not found/);
  assert.equal(await Wallet.countDocuments({ user: f.freelancer._id }), 0);
  assert.equal((await Payment.findById(payment._id)).escrowStatus, 'funded');
  assert.equal(await Transaction.countDocuments({ payment: payment._id, type: 'escrow_release' }), 0);
  assert.equal((await Milestone.findById(f.milestone._id)).status, 'approved');
});

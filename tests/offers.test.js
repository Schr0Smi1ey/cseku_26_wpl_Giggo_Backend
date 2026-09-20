import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Job } = await import('../src/models/Job.js');
const { Offer } = await import('../src/models/Offer.js');
const { OfferMessage } = await import('../src/models/OfferMessage.js');
const { OfferRevision } = await import('../src/models/OfferRevision.js');
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
  const token = `offer-token-${id}`;
  claims.set(token, {
    sub: id,
    email: `${id}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: id, signup_role: role },
  });
  return token;
};

const jobBody = {
  title: 'Build an accessible analytics dashboard',
  description: 'Create a responsive analytics dashboard with reusable components and tested API integration.',
  category: 'Development & IT',
  skills: ['React', 'Node.js'],
  budget: { type: 'fixed', min: 600, max: 1200, currency: 'USD' },
};
const proposalBody = {
  coverLetter: 'I can build this dashboard with accessible reusable components, secure API integration, and reviewable delivery milestones.',
  bid: { amount: 800, type: 'fixed', currency: 'USD' },
  estimatedDays: 14,
  milestones: [{ title: 'Dashboard delivery', amount: 800, description: 'Responsive dashboard with API integration.' }],
};
const offerBody = {
  title: 'Accessible analytics dashboard delivery',
  description: 'Deliver the responsive analytics dashboard described in the job with tested API integration.',
  budget: { amount: 800, type: 'fixed', currency: 'USD' },
  estimatedDays: 14,
  terms: 'Source code, setup documentation, and a final walkthrough are included.',
  milestones: [{ title: 'Dashboard delivery', amount: 800, description: 'Complete dashboard and documentation.' }],
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([OfferMessage.deleteMany({}), OfferRevision.deleteMany({}), Offer.deleteMany({}), Proposal.deleteMany({}), Job.deleteMany({}), User.deleteMany({})]);
});
after(async () => disconnectDB());

async function shortlistedApplication(suffix = 'flow') {
  const clientToken = tokenFor(`offer-client-${suffix}`, 'client');
  const freelancerToken = tokenFor(`offer-freelancer-${suffix}`, 'freelancer');
  const jobResponse = await request(app).post('/api/jobs').set(auth(clientToken)).send(jobBody).expect(201);
  const job = jobResponse.body.data.job;
  const proposalResponse = await request(app)
    .post('/api/proposals')
    .set(auth(freelancerToken))
    .send({ job: job._id, ...proposalBody })
    .expect(201);
  const proposal = proposalResponse.body.data.proposal;
  await request(app)
    .post(`/api/proposals/${proposal._id}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'shortlist' })
    .expect(200);
  return { clientToken, freelancerToken, job, proposal };
}

test('clients and freelancers complete the offer negotiation and acceptance workflow', async () => {
  const { clientToken, freelancerToken, job, proposal } = await shortlistedApplication();

  const created = await request(app)
    .post('/api/offers')
    .set(auth(clientToken))
    .send({ proposal: proposal._id, ...offerBody })
    .expect(201);
  const offer = created.body.data.offer;
  assert.equal(offer.status, 'draft');
  assert.equal(offer.revision, 1);
  assert.equal(offer.job._id, job._id);
  assert.equal(offer.proposal._id, proposal._id);

  const clientProposal = await request(app).get(`/api/proposals/${proposal._id}`).set(auth(clientToken)).expect(200);
  assert.equal(clientProposal.body.data.proposal.offer.status, 'draft');
  const freelancerProposal = await request(app).get(`/api/proposals/${proposal._id}`).set(auth(freelancerToken)).expect(200);
  assert.equal(freelancerProposal.body.data.proposal.offer, null);

  await request(app).get('/api/offers').set(auth(freelancerToken)).expect(200).expect((response) => {
    assert.equal(response.body.data.pagination.total, 0);
  });
  await request(app).get('/api/offers?status=draft').set(auth(freelancerToken)).expect(200).expect((response) => {
    assert.equal(response.body.data.pagination.total, 0);
  });

  const revised = await request(app)
    .patch(`/api/offers/${offer._id}`)
    .set(auth(clientToken))
    .send({
      budget: { amount: 900, type: 'fixed', currency: 'USD' },
      milestones: [{ title: 'Dashboard delivery', amount: 900, description: 'Complete dashboard, tests, and documentation.' }],
    })
    .expect(200);
  assert.equal(revised.body.data.offer.revision, 1);
  assert.equal(revised.body.data.offer.budget.amount, 900);

  const sent = await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  assert.equal(sent.body.data.offer.status, 'sent');
  assert.ok(sent.body.data.offer.sentAt);
  assert.ok(sent.body.data.offer.expiresAt);
  assert.equal(sent.body.data.offer.revisions.length, 1);
  assert.equal(sent.body.data.offer.revisions[0].number, 1);
  const visibleSentOffer = await request(app).get(`/api/proposals/${proposal._id}`).set(auth(freelancerToken)).expect(200);
  assert.equal(visibleSentOffer.body.data.proposal.offer.status, 'sent');

  await request(app)
    .post(`/api/proposals/${proposal._id}/decision`)
    .set(auth(clientToken))
    .send({ decision: 'reject' })
    .expect(409);

  const freelancerList = await request(app).get('/api/offers?status=sent').set(auth(freelancerToken)).expect(200);
  assert.equal(freelancerList.body.data.items.length, 1);
  assert.equal(freelancerList.body.data.items[0].client.name, 'offer-client-flow');

  const changes = await request(app)
    .post(`/api/offers/${offer._id}/request-changes`)
    .set(auth(freelancerToken))
    .send({ message: 'Please include deployment support in the final delivery.' })
    .expect(200);
  assert.equal(changes.body.data.offer.status, 'changes_requested');
  assert.equal(changes.body.data.offer.messages.at(-1).kind, 'change_request');

  const addressed = await request(app)
    .patch(`/api/offers/${offer._id}`)
    .set(auth(clientToken))
    .send({ terms: 'Source code, setup documentation, deployment support, and a final walkthrough are included.' })
    .expect(200);
  assert.equal(addressed.body.data.offer.status, 'revising');
  assert.equal(addressed.body.data.offer.revision, 2);
  const previousTermsDuringRevision = await request(app).get(`/api/offers/${offer._id}`).set(auth(freelancerToken)).expect(200);
  assert.equal(previousTermsDuringRevision.body.data.offer.revisionPending, true);
  assert.equal(previousTermsDuringRevision.body.data.offer.displayRevision, 1);
  assert.equal(previousTermsDuringRevision.body.data.offer.terms, offerBody.terms);

  const resent = await request(app).post(`/api/offers/${offer._id}/send`).set(auth(clientToken)).expect(200);
  assert.deepEqual(resent.body.data.offer.revisions.map((item) => item.number), [2, 1]);
  assert.equal(resent.body.data.offer.revisions[1].terms, offerBody.terms);
  assert.match(resent.body.data.offer.revisions[0].terms, /deployment support/);

  await request(app)
    .post(`/api/offers/${offer._id}/messages`)
    .set(auth(clientToken))
    .send({ message: 'The deployment support is now included in revision 2.' })
    .expect(201);
  await request(app)
    .post(`/api/offers/${offer._id}/messages`)
    .set(auth(freelancerToken))
    .send({ message: 'Email me at freelancer@example.com' })
    .expect(400);

  await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(409);
  const accepted = await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 2 }).expect(200);
  assert.equal(accepted.body.data.offer.status, 'accepted');
  assert.ok(accepted.body.data.offer.acceptedAt);
  assert.equal(accepted.body.data.offer.revisions.length, 2);
  assert.equal(accepted.body.data.offer.messages.at(-1).kind, 'system');

  await request(app)
    .post(`/api/offers/${offer._id}/messages`)
    .set(auth(freelancerToken))
    .send({ message: 'You can now reach me at freelancer@example.com.' })
    .expect(201);

  const [storedProposal, storedJob] = await Promise.all([
    Proposal.findById(proposal._id).lean(),
    Job.findById(job._id).lean(),
  ]);
  assert.equal(storedProposal.status, 'accepted');
  assert.equal(storedJob.status, 'filled');
  assert.equal(String(storedJob.hiredProposal), proposal._id);

  await request(app).patch(`/api/jobs/${job._id}`).set(auth(clientToken)).send({ status: 'open' }).expect(409);
  await request(app).delete(`/api/jobs/${job._id}`).set(auth(clientToken)).expect(409);

  const repeated = await request(app).post(`/api/offers/${offer._id}/accept`).set(auth(freelancerToken)).send({ revision: 2 }).expect(200);
  assert.equal(repeated.body.data.offer.status, 'accepted');
});

test('offer validation, authorization, active-offer uniqueness, and terminal actions are enforced', async () => {
  const { clientToken, freelancerToken, job, proposal } = await shortlistedApplication('guards');
  const outsiderClient = tokenFor('offer-outsider-client', 'client');
  const outsiderFreelancer = tokenFor('offer-outsider-freelancer', 'freelancer');
  const unshortlistedFreelancer = tokenFor('offer-unshortlisted-freelancer', 'freelancer');
  await request(app).get('/api/auth/me').set(auth(outsiderClient)).expect(200);
  await request(app).get('/api/auth/me').set(auth(outsiderFreelancer)).expect(200);

  const unshortlisted = await request(app)
    .post('/api/proposals')
    .set(auth(unshortlistedFreelancer))
    .send({ job: job._id, ...proposalBody })
    .expect(201);
  await request(app)
    .post('/api/offers')
    .set(auth(clientToken))
    .send({ proposal: unshortlisted.body.data.proposal._id, ...offerBody })
    .expect(400);

  await request(app).post('/api/offers').send({ proposal: proposal._id, ...offerBody }).expect(401);
  await request(app).post('/api/offers').set(auth(freelancerToken)).send({ proposal: proposal._id, ...offerBody }).expect(403);
  await request(app)
    .post('/api/offers')
    .set(auth(clientToken))
    .send({ proposal: proposal._id, ...offerBody, budget: { amount: 850, type: 'fixed', currency: 'USD' } })
    .expect(400);

  const created = await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...offerBody }).expect(201);
  const offerId = created.body.data.offer._id;
  await request(app).patch(`/api/offers/${offerId}`).set(auth(clientToken)).send({}).expect(400);
  await request(app).post('/api/offers').set(auth(clientToken)).send({ proposal: proposal._id, ...offerBody }).expect(409);
  await request(app).get(`/api/offers/${offerId}`).set(auth(outsiderClient)).expect(404);
  await request(app).get(`/api/offers/${offerId}`).set(auth(outsiderFreelancer)).expect(404);

  await request(app).post(`/api/offers/${offerId}/send`).set(auth(freelancerToken)).expect(403);
  await request(app).post(`/api/offers/${offerId}/send`).set(auth(clientToken)).expect(200);
  await request(app).post(`/api/offers/${offerId}/accept`).set(auth(clientToken)).send({ revision: 1 }).expect(403);
  await request(app)
    .post(`/api/offers/${offerId}/messages`)
    .set(auth(outsiderFreelancer))
    .send({ message: 'I should not be part of this conversation.' })
    .expect(404);
  await request(app)
    .post(`/api/offers/${offerId}/request-changes`)
    .set(auth(freelancerToken))
    .send({ message: 'Contact me at hidden@example.com instead.' })
    .expect(400);
  const revokedForRevision = await request(app)
    .patch(`/api/offers/${offerId}`)
    .set(auth(clientToken))
    .send({ terms: 'The sent offer is being revised before the freelancer responds.' })
    .expect(200);
  assert.equal(revokedForRevision.body.data.offer.status, 'revising');
  await request(app).post(`/api/offers/${offerId}/accept`).set(auth(freelancerToken)).send({ revision: 1 }).expect(409);
  await request(app).post(`/api/offers/${offerId}/send`).set(auth(clientToken)).expect(200);
  await request(app).post(`/api/offers/${offerId}/reject`).set(auth(freelancerToken)).expect(200);
  await request(app).post(`/api/offers/${offerId}/accept`).set(auth(freelancerToken)).send({ revision: 2 }).expect(400);

  const replacement = await request(app)
    .post('/api/offers')
    .set(auth(clientToken))
    .send({ proposal: proposal._id, ...offerBody, title: 'Revised dashboard engagement' })
    .expect(201);
  await request(app).post(`/api/offers/${replacement.body.data.offer._id}/withdraw`).set(auth(clientToken)).expect(200);

  assert.equal(await Offer.countDocuments({ proposal: proposal._id }), 2);
  await request(app).delete(`/api/jobs/${job._id}`).set(auth(clientToken)).expect(200);
  assert.equal(await Offer.countDocuments({ job: job._id }), 0);
  assert.equal(await OfferRevision.countDocuments({ offer: mongoose.trusted({ $in: [offerId, replacement.body.data.offer._id] }) }), 0);
  assert.equal(await OfferMessage.countDocuments({ offer: mongoose.trusted({ $in: [offerId, replacement.body.data.offer._id] }) }), 0);
});

test('a job accepts only one offer even when different shortlisted applicants respond concurrently', async () => {
  const clientToken = tokenFor('offer-client-concurrent', 'client');
  const freelancerAToken = tokenFor('offer-freelancer-a', 'freelancer');
  const freelancerBToken = tokenFor('offer-freelancer-b', 'freelancer');
  const jobResponse = await request(app).post('/api/jobs').set(auth(clientToken)).send(jobBody).expect(201);
  const job = jobResponse.body.data.job;

  const proposalResponses = await Promise.all([
    request(app).post('/api/proposals').set(auth(freelancerAToken)).send({ job: job._id, ...proposalBody }),
    request(app).post('/api/proposals').set(auth(freelancerBToken)).send({ job: job._id, ...proposalBody, bid: { ...proposalBody.bid, amount: 850 } }),
  ]);
  for (const response of proposalResponses) assert.equal(response.status, 201);
  const proposals = proposalResponses.map((response) => response.body.data.proposal);
  for (const proposal of proposals) {
    await request(app).post(`/api/proposals/${proposal._id}/decision`).set(auth(clientToken)).send({ decision: 'shortlist' }).expect(200);
  }
  const offers = [];
  for (const [index, proposal] of proposals.entries()) {
    const response = await request(app)
      .post('/api/offers')
      .set(auth(clientToken))
      .send({ proposal: proposal._id, ...offerBody, title: `Dashboard offer ${index + 1}` })
      .expect(201);
    offers.push(response.body.data.offer);
    await request(app).post(`/api/offers/${response.body.data.offer._id}/send`).set(auth(clientToken)).expect(200);
  }

  const responses = await Promise.all([
    request(app).post(`/api/offers/${offers[0]._id}/accept`).set(auth(freelancerAToken)).send({ revision: 1 }),
    request(app).post(`/api/offers/${offers[1]._id}/accept`).set(auth(freelancerBToken)).send({ revision: 1 }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await Offer.countDocuments({ job: job._id, status: 'accepted' }), 1);
  assert.equal(await Proposal.countDocuments({ job: job._id, status: 'accepted' }), 1);
  assert.equal(await Job.countDocuments({ _id: job._id, status: 'filled' }), 1);
});

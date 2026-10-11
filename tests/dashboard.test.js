import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const mongoose = (await import('mongoose')).default;
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { Contract } = await import('../src/models/Contract.js');
const { SavedJob } = await import('../src/models/SavedJob.js');
const { WalletLedgerEntry } = await import('../src/models/WalletLedgerEntry.js');
const claims = new Map();
setSupabaseTokenVerifierForTests(async token => { if (!claims.has(token)) throw new Error('Unknown token'); return claims.get(token); });
const app = createApp();
before(connectDB); after(disconnectDB);

test('dashboard totals belong to the current account, omit inactive proposals and subtract refunds by currency', async () => {
  const users = {};
  for (const [name, role] of [['client', 'client'], ['freelancer', 'freelancer'], ['otherClient', 'client'], ['otherFreelancer', 'freelancer']]) {
    claims.set(name, { sub: name, email: `${name}@example.test`, email_confirmed_at: new Date().toISOString(), user_metadata: { name, signup_role: role } });
    const result = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${name}`).expect(200);
    users[name] = new mongoose.Types.ObjectId(result.body.data.user._id);
  }
  const pairs = { client: users.client, freelancer: users.freelancer };
  await Proposal.collection.insertMany(['submitted', 'shortlisted', 'accepted', 'withdrawn'].map(status => ({ ...pairs, status, job: new mongoose.Types.ObjectId() })).concat([{ client: users.otherClient, freelancer: users.otherFreelancer, status: 'submitted', job: new mongoose.Types.ObjectId() }]));
  await Contract.collection.insertMany([{ ...pairs, status: 'active' }, { ...pairs, status: 'cancelled' }, { client: users.otherClient, freelancer: users.otherFreelancer, status: 'active' }].map(row => ({ ...row, offer: new mongoose.Types.ObjectId(), job: new mongoose.Types.ObjectId() })));
  await SavedJob.collection.insertMany([{ user: users.freelancer, job: new mongoose.Types.ObjectId() }, { user: users.otherFreelancer, job: new mongoose.Types.ObjectId() }]);
  await WalletLedgerEntry.collection.insertMany([
    { user: users.client, type: 'client_payment', direction: 'debit', amount: 100, currency: 'BDT' },
    { user: users.client, type: 'refund', direction: 'credit', amount: 30, currency: 'BDT' },
    { user: users.client, type: 'card_reload', direction: 'credit', amount: 1000, currency: 'BDT' },
    { user: users.client, type: 'client_payment', direction: 'debit', amount: 4, currency: 'USD' },
    { user: users.otherClient, type: 'client_payment', direction: 'debit', amount: 999, currency: 'BDT' },
  ].map((row, index) => ({ ...row, entryNumber: `LED-dashboard-${index}` })));
  const client = await request(app).get('/api/dashboard/summary').set('Authorization', 'Bearer client').expect(200);
  assert.deepEqual(client.body.data, { activeContracts: 1, receivedProposals: 4, spending: [{ currency: 'BDT', amount: 70 }, { currency: 'USD', amount: 4 }] });
  const freelancer = await request(app).get('/api/dashboard/summary').set('Authorization', 'Bearer freelancer').expect(200);
  assert.deepEqual(freelancer.body.data, { activeContracts: 1, activeProposals: 2, savedJobs: 1 });
  await request(app).get('/api/dashboard/summary').expect(401);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';
const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'giggo-delete-test-'));
process.env.UPLOAD_DIR = runtimeDir;
process.env.AVATAR_UPLOAD_DIR = path.join(runtimeDir, 'avatars');

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { AIAnalysis } = await import('../src/models/AIAnalysis.js');
const { AIUsage } = await import('../src/models/AIUsage.js');
const { ClientProfile } = await import('../src/models/ClientProfile.js');
const { DeletedIdentity } = await import('../src/models/DeletedIdentity.js');
const { FreelancerProfile } = await import('../src/models/FreelancerProfile.js');
const { Job } = await import('../src/models/Job.js');
const { Offer } = await import('../src/models/Offer.js');
const { Proposal } = await import('../src/models/Proposal.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { SavedJob } = await import('../src/models/SavedJob.js');
const { User } = await import('../src/models/User.js');
const { VerificationRequest } = await import('../src/models/VerificationRequest.js');
const { ApiError } = await import('../src/utils/ApiError.js');
const { accountDeletionService } = await import('../src/services/account-deletion.service.js');
const { setSupabaseAdminDeleteForTests } = await import('../src/services/supabase-admin.service.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
const deletedSupabaseIds = [];
let adminDeleteFailure = null;

setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown token');
  return claims.get(token);
});
setSupabaseAdminDeleteForTests(async (supabaseUserId) => {
  if (adminDeleteFailure) throw adminDeleteFailure;
  deletedSupabaseIds.push(supabaseUserId);
});

const app = createApp();

function tokenFor(id, email, issuedAt = Math.floor(Date.now() / 1000)) {
  const token = `delete-token-${id}-${issuedAt}`;
  claims.set(token, {
    sub: id,
    email,
    iat: issuedAt,
    user_metadata: { name: 'Delete Test', signup_role: 'freelancer' },
  });
  return token;
}

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  deletedSupabaseIds.length = 0;
  adminDeleteFailure = null;
  await Promise.all([
    AIAnalysis.deleteMany({}),
    AIUsage.deleteMany({}),
    ClientProfile.deleteMany({}),
    DeletedIdentity.deleteMany({}),
    FreelancerProfile.deleteMany({}),
    Job.deleteMany({}),
    Offer.deleteMany({}),
    Proposal.deleteMany({}),
    RefreshToken.deleteMany({}),
    SavedJob.deleteMany({}),
    User.deleteMany({}),
    VerificationRequest.deleteMany({}),
    fs.rm(runtimeDir, { recursive: true, force: true }),
  ]);
});
after(async () => {
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await disconnectDB();
});

async function provision(token) {
  const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  return response.body.data.user;
}

test('fresh authentication tolerates a slightly faster issuer clock and deletes the account', async () => {
  const supabaseUserId = 'delete-user-1';
  const token = tokenFor(supabaseUserId, 'delete@example.test', Math.floor(Date.now() / 1000) + 5);
  const user = await provision(token);
  await fs.mkdir(runtimeDir, { recursive: true });
  const cvPath = path.join(runtimeDir, 'resume.txt');
  const verificationPath = path.join(runtimeDir, 'identity.txt');
  await Promise.all([fs.writeFile(cvPath, 'resume'), fs.writeFile(verificationPath, 'identity')]);

  await FreelancerProfile.create({ user: user._id, cv: { filename: 'resume.txt', mimeType: 'text/plain', size: 6, storageKey: cvPath, uploadedAt: new Date() } });
  await ClientProfile.create({ user: user._id, companyName: 'Delete Me' });
  await VerificationRequest.create({ user: user._id, type: 'identity', documents: [{ filename: 'identity.txt', mimeType: 'text/plain', path: verificationPath }] });
  await RefreshToken.create({ user: user._id, tokenHash: 'delete-token-hash', family: 'delete-family', expiresAt: new Date(Date.now() + 60_000) });
  await AIAnalysis.create({
    user: user._id,
    textHash: 'delete-analysis-hash',
    provider: 'heuristic',
    source: { kind: 'text' },
    result: { summary: 'Delete this analysis', overallScore: 50, atsScore: 50, disclaimer: 'Advisory only' },
  });
  await AIUsage.create({ user: user._id, feature: 'proposal_draft', provider: 'heuristic' });
  const job = await Job.create({ client: user._id, title: 'Delete this job', description: 'This job belongs to an account scheduled for permanent deletion.', category: 'Development & IT' });
  const proposal = await Proposal.create({
    job: job._id,
    freelancer: user._id,
    client: user._id,
    coverLetter: 'Delete this proposal together with the account and every related marketplace record stored for the user.',
    bid: { amount: 100, type: 'fixed', currency: 'USD' },
    estimatedDays: 5,
  });
  await Offer.create({
    client: user._id,
    freelancer: user._id,
    job: job._id,
    proposal: proposal._id,
    title: 'Delete this offer',
    description: 'Delete this marketplace offer together with the related account records.',
    budget: { amount: 100, type: 'fixed', currency: 'USD' },
    estimatedDays: 5,
  });
  await SavedJob.create({ user: user._id, job: job._id });

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZQAAAAASUVORK5CYII=', 'base64');
  await request(app)
    .post('/api/profiles/me/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', png, { filename: 'profile.png', contentType: 'image/png' })
    .expect(200);
  const accountWithAvatar = await User.findById(user._id).select('+avatarStorageKey');
  const avatarPath = accountWithAvatar.avatarStorageKey;

  const deleted = await request(app)
    .delete('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmation: 'DELETE' })
    .expect(200);
  assert.equal(deleted.body.data.deleted, true);
  assert.deepEqual(deletedSupabaseIds, [supabaseUserId]);

  const counts = await Promise.all([
    User.countDocuments({ _id: user._id }),
    FreelancerProfile.countDocuments({ user: user._id }),
    ClientProfile.countDocuments({ user: user._id }),
    AIAnalysis.countDocuments({ user: user._id }),
    AIUsage.countDocuments({ user: user._id }),
    VerificationRequest.countDocuments({ user: user._id }),
    Job.countDocuments({ client: user._id }),
    Offer.countDocuments({ $or: [{ freelancer: user._id }, { client: user._id }] }),
    Proposal.countDocuments({ $or: [{ freelancer: user._id }, { client: user._id }] }),
    SavedJob.countDocuments({ user: user._id }),
    RefreshToken.countDocuments({ user: user._id }),
  ]);
  assert.deepEqual(counts, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(await DeletedIdentity.countDocuments({ supabaseUserId }), 1);
  await Promise.all([
    assert.rejects(fs.access(cvPath)),
    assert.rejects(fs.access(verificationPath)),
    assert.rejects(fs.access(avatarPath)),
  ]);

  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  await request(app)
    .delete('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmation: 'DELETE' })
    .expect(401);
  assert.equal(await User.countDocuments({ supabaseUserId }), 0);
});

test('account deletion rejects unauthenticated requests', async () => {
  await request(app)
    .delete('/api/auth/account')
    .send({ confirmation: 'DELETE' })
    .expect(401);
  assert.equal(deletedSupabaseIds.length, 0);
});

test('deletion rejects missing, invalid, stale, and far-future authentication timestamps', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const issuedAt of [undefined, 0, -1, Infinity, NaN, now - 601, now + 120]) {
    await assert.rejects(
      accountDeletionService.remove(null, { issuedAt }),
      (error) => error.code === 'RECENT_AUTH_REQUIRED',
    );
  }
  assert.equal(deletedSupabaseIds.length, 0);
});

test('account deletion requires exact confirmation and recent authentication', async () => {
  const staleIssuedAt = Math.floor(Date.now() / 1000) - (11 * 60);
  const token = tokenFor('delete-user-2', 'stale@example.test', staleIssuedAt);
  const user = await provision(token);

  await request(app)
    .delete('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmation: 'delete' })
    .expect(400);
  const stale = await request(app)
    .delete('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmation: 'DELETE' })
    .expect(401);
  assert.equal(stale.body.error.code, 'RECENT_AUTH_REQUIRED');
  assert.equal(await User.countDocuments({ _id: user._id, status: 'active' }), 1);
  assert.equal(deletedSupabaseIds.length, 0);
});

test('failed Supabase deletion restores the active account and removes its tombstone', async () => {
  const supabaseUserId = 'delete-user-3';
  const token = tokenFor(supabaseUserId, 'failure@example.test');
  const user = await provision(token);
  await FreelancerProfile.create({ user: user._id, title: 'Keep this profile' });
  adminDeleteFailure = new ApiError(502, 'Authentication deletion failed', 'IDENTITY_DELETION_FAILED');

  const response = await request(app)
    .delete('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmation: 'DELETE' })
    .expect(502);
  assert.equal(response.body.error.code, 'IDENTITY_DELETION_FAILED');
  assert.equal(await User.countDocuments({ _id: user._id, status: 'active' }), 1);
  assert.equal(await FreelancerProfile.countDocuments({ user: user._id }), 1);
  assert.equal(await DeletedIdentity.countDocuments({ supabaseUserId }), 0);
});

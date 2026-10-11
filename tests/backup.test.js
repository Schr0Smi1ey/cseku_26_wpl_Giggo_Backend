import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptDatabase, decryptBackup, restoreIntoEmptyDatabase } from '../scripts/encrypted-backup.js';
test('encrypted backup authenticates its payload and refuses nonempty restore targets', async () => {
  const key = randomBytes(32);
  const source = { listCollections: () => ({ toArray: async () => [{ name: 'users' }] }), collection: () => ({ find: () => ({ batchSize: () => [{ name: 'Isolated fixture', createdAt: new Date('2026-01-01') }] }) }) };
  const backup = await encryptDatabase(source, key);
  assert.equal(backup.includes(Buffer.from('Isolated fixture')), false);
  const rows = decryptBackup(backup, key);
  assert.equal(rows[1].document.name, 'Isolated fixture');
  assert.throws(() => decryptBackup(backup, randomBytes(32)));
  const modified = Buffer.from(backup); modified[modified.length - 1] ^= 1;
  assert.throws(() => decryptBackup(modified, key));
  await assert.rejects(restoreIntoEmptyDatabase({ listCollections: () => ({ hasNext: async () => true }) }, rows), /empty/);
});

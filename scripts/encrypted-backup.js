import 'dotenv/config';
import mongoose from 'mongoose';
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { EJSON } = mongoose.mongo.BSON;
const MAGIC = Buffer.from('GIGGOBK1');
export async function encryptDatabase(db, key) {
  const rows = []; let size = 0;
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith('system.')) continue;
    rows.push(JSON.stringify({ collection: name, empty: true }));
    for await (const document of db.collection(name).find({}).batchSize(200)) {
      const line = JSON.stringify({ collection: name, document: EJSON.serialize(document) });
      size += Buffer.byteLength(line);
      if (size > 64 * 1024 * 1024 || rows.length > 100000) throw new Error('Use an approved streaming database backup for databases larger than this bounded export');
      rows.push(line);
    }
  }
  const payload = gzipSync(Buffer.from(rows.join('\n'))), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(buffer, key) {
  if (buffer.length < 36 || !timingSafeEqual(buffer.subarray(0, 8), MAGIC)) throw new Error('Invalid Giggo backup header');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(8, 20));
  decipher.setAuthTag(buffer.subarray(20, 36));
  const payload = gunzipSync(Buffer.concat([decipher.update(buffer.subarray(36)), decipher.final()]), { maxOutputLength: 70 * 1024 * 1024 });
  return payload.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
export async function restoreIntoEmptyDatabase(db, rows) {
  if (await db.listCollections({}, { nameOnly: true }).hasNext()) throw new Error('Restore target must be a new empty database');
  const counts = {};
  for (const row of rows) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(row.collection) || row.collection.startsWith('system.')) throw new Error('Invalid collection name');
    if (row.empty) { await db.createCollection(row.collection); counts[row.collection] = 0; }
    else { await db.collection(row.collection).insertOne(EJSON.deserialize(row.document)); counts[row.collection] = (counts[row.collection] || 0) + 1; }
  }
  return counts;
}
async function main() {
  const command = process.argv[2], directory = path.resolve('.runtime/backups');
  await fs.mkdir(directory, { recursive: true });
  const keyPath = path.join(directory, 'encryption.key');
  let key;
  try { key = await fs.readFile(keyPath); } catch (e) { if (e.code !== 'ENOENT' || command !== 'backup') throw e; key = randomBytes(32); await fs.writeFile(keyPath, key, { flag: 'wx', mode: 0o600 }); }
  if (key.length !== 32) throw new Error('Invalid encryption key');
  if (command === 'backup') {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI);
    try {
      await client.connect();
      const buffer = await encryptDatabase(client.db(process.env.MONGODB_DB_NAME), key);
      const file = path.join(directory, `giggo-${new Date().toISOString().replace(/[:.]/g, '-')}.enc`);
      await fs.writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ file, sha256: createHash('sha256').update(buffer).digest('hex'), encrypted: true }));
    } finally { await client.close(); }
  } else if (command === 'verify') {
    const file = path.resolve(process.argv[3] || '');
    if (!file.startsWith(directory + path.sep) || !file.endsWith('.enc')) throw new Error('Select an encrypted backup in .runtime/backups');
    const rows = decryptBackup(await fs.readFile(file), key);
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 120000 }] });
    const client = new mongoose.mongo.MongoClient(server.getUri());
    try { await client.connect(); const db = client.db('giggo_isolated_restore'); const counts = await restoreIntoEmptyDatabase(db, rows); for (const [collection, expected] of Object.entries(counts)) if (await db.collection(collection).countDocuments({}) !== expected) throw new Error('Restore count mismatch'); console.log(JSON.stringify({ verified: true, isolated: true, collections: Object.keys(counts).length, documents: Object.values(counts).reduce((sum, n) => sum + n, 0) })); }
    finally { await client.close(); await server.stop(); }
  } else throw new Error('Use backup or verify <encrypted-file>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Backup or isolated restore verification failed. No production restore was performed.'); process.exitCode = 1; });

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';
const bucket = process.env.PRIVATE_UPLOAD_BUCKET || 'giggo-private-documents';
const cloud = () => !config.isTest && (config.isProduction || process.env.PRIVATE_UPLOAD_STORAGE === 'supabase');
let bucketPromise;
function remoteKey(value) {
  const prefix = `supabase://${bucket}/`;
  if (!String(value).startsWith(prefix)) throw ApiError.notFound('Private document not found');
  const key = value.slice(prefix.length);
  if (!/^(cv|verification)\/[a-zA-Z0-9-]+\/[a-f\d-]+\.[a-z0-9]+$/.test(key)) throw ApiError.notFound('Private document not found');
  return key;
}
async function storageRequest(endpoint, options = {}) {
  if (!config.supabase.url || !config.supabase.serviceRoleKey || !/^[a-z0-9-]+$/.test(bucket)) throw new ApiError(503, 'Private document storage is not configured', 'STORAGE_UNAVAILABLE');
  let response;
  try { response = await fetch(`${config.supabase.url}/storage/v1${endpoint}`, { ...options, headers: { apikey: config.supabase.serviceRoleKey, Authorization: `Bearer ${config.supabase.serviceRoleKey}`, ...options.headers }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new ApiError(503, 'Private document storage is temporarily unavailable', 'STORAGE_UNAVAILABLE'); }
  return response;
}
async function ensureBucket() {
  bucketPromise ||= (async () => {
    let response = await storageRequest(`/bucket/${bucket}`);
    if (response.status === 404 || response.status === 400) {
      const created = await storageRequest('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 3145728, allowed_mime_types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/jpeg', 'image/png', 'image/webp'] }) });
      if (!created.ok && created.status !== 409 && created.status !== 400) throw new ApiError(503, 'Private document storage could not be initialized', 'STORAGE_UNAVAILABLE');
      response = await storageRequest(`/bucket/${bucket}`);
    }
    if (!response.ok || (await response.json()).public !== false) throw new ApiError(503, 'A private document bucket is required', 'STORAGE_UNAVAILABLE');
  })().catch(error => { bucketPromise = null; throw error; });
  await bucketPromise;
}
export async function storePrivateUpload(file, { directory, folder, owner = 'unassigned', extension }) {
  if (file.buffer.length > 3145728) throw ApiError.badRequest('Private documents must be 3 MB or smaller');
  if (cloud()) {
    await ensureBucket();
    const key = `${folder}/${owner}/${randomUUID()}${extension}`;
    const response = await storageRequest(`/object/${bucket}/${key}`, { method: 'POST', headers: { 'Content-Type': file.mimetype, 'x-upsert': 'false' }, body: file.buffer });
    if (!response.ok) throw new ApiError(503, 'Private document upload failed; retry later', 'STORAGE_UNAVAILABLE');
    return `supabase://${bucket}/${key}`;
  }
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${owner}-${randomUUID()}${extension}`);
  await fs.writeFile(destination, file.buffer, { flag: 'wx' });
  return destination;
}
export async function readPrivateUpload(key) {
  if (!String(key).startsWith('supabase://')) return fs.readFile(key);
  const response = await storageRequest(`/object/authenticated/${bucket}/${remoteKey(key)}`);
  if (response.status === 404 || response.status === 400) throw ApiError.notFound('Private document not found');
  if (!response.ok) throw new ApiError(503, 'Private document could not be loaded', 'STORAGE_UNAVAILABLE');
  return Buffer.from(await response.arrayBuffer());
}
export async function removePrivateUpload(key) {
  const objectKey = remoteKey(key);
  const response = await storageRequest(`/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [objectKey] }) });
  if (!response.ok && response.status !== 404) throw new ApiError(503, 'Private document removal could not complete', 'STORAGE_UNAVAILABLE');
}

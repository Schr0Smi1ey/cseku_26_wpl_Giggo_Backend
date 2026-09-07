import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';

const documentsDirectory = path.resolve(config.storage.uploadDir || path.join(process.cwd(), '.runtime', 'uploads', 'verification'));

function extension(filename) {
  const value = path.extname(filename || '').toLowerCase();
  return value && value.length <= 10 ? value : '';
}

function isInsideDocumentsDirectory(filePath) {
  const relative = path.relative(documentsDirectory, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function storeVerificationDocument(file) {
  await fs.mkdir(documentsDirectory, { recursive: true });
  const destination = path.join(documentsDirectory, `${crypto.randomUUID()}${extension(file.originalname)}`);
  await fs.writeFile(destination, file.buffer, { flag: 'wx' });
  return destination;
}

export async function removeVerificationDocument(filePath) {
  if (!filePath || !isInsideDocumentsDirectory(filePath)) return;
  await fs.rm(filePath, { force: true });
}

export async function readVerificationDocument(filePath) {
  if (!filePath || !isInsideDocumentsDirectory(filePath)) throw ApiError.notFound('Document not found');
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    throw ApiError.notFound('Document not found');
  }
}

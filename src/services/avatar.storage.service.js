import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';
import { uploadImgBbAvatar } from '../integrations/storage/imgbb-avatar.js';

const avatarDirectory = path.resolve(
  config.storage.avatarUploadDir || path.join(process.cwd(), '.runtime', 'uploads', 'avatars'),
);

const formats = {
  'image/jpeg': { extension: '.jpg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: '.png', matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: '.webp', matches: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
};

const publicNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

function isInsideAvatarDirectory(filePath) {
  const relative = path.relative(avatarDirectory, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function formatFor(file) {
  const format = formats[file?.mimetype];
  if (!format || !Buffer.isBuffer(file.buffer) || !format.matches(file.buffer)) {
    throw ApiError.badRequest('The profile photo content does not match a supported image format');
  }
  return format;
}

export async function storeAvatar(file) {
  if (!file?.buffer?.length) throw ApiError.badRequest('Attach a profile photo');
  const format = formatFor(file);
  if (config.storage.avatarProvider === 'imgbb') {
    return uploadImgBbAvatar(file, { extension: format.extension });
  }
  if (config.storage.avatarProvider !== 'local') {
    throw new ApiError(503, 'Avatar storage provider is not configured', 'STORAGE_CONFIGURATION_ERROR');
  }
  await fs.mkdir(avatarDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}${format.extension}`;
  const storageKey = path.join(avatarDirectory, filename);
  await fs.writeFile(storageKey, file.buffer, { flag: 'wx' });
  return { storageKey, url: `/api/profiles/avatars/${filename}`, provider: 'local' };
}

export async function removeAvatarAsset(storageKey, provider = 'local') {
  // ImgBB v1 supplies a private browser deletion link but documents no
  // authenticated server-side deletion endpoint. Keep the reference private;
  // removal from Giggo detaches the public URL without pretending remote
  // deletion was confirmed.
  if (provider === 'imgbb') return { remoteCopyMayRemain: Boolean(storageKey) };
  if (!storageKey || !isInsideAvatarDirectory(storageKey)) return;
  await fs.rm(storageKey, { force: true });
  return { remoteCopyMayRemain: false };
}

export async function readAvatar(filename) {
  if (!publicNamePattern.test(filename || '')) throw ApiError.notFound('Profile photo not found');
  const storageKey = path.join(avatarDirectory, filename);
  if (!isInsideAvatarDirectory(storageKey)) throw ApiError.notFound('Profile photo not found');
  try {
    const buffer = await fs.readFile(storageKey);
    const extension = path.extname(filename).toLowerCase();
    const mimeType = extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'image/webp';
    return { buffer, mimeType };
  } catch (error) {
    if (error?.code === 'ENOENT') throw ApiError.notFound('Profile photo not found');
    throw error;
  }
}

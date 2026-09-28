import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { ApiError } from '../../utils/ApiError.js';

function trustedImgBbUrl(value) {
  try {
    const url = new URL(value);
    const trustedHost = url.hostname === 'ibb.co' || url.hostname.endsWith('.ibb.co');
    return url.protocol === 'https:' && trustedHost ? url.toString() : '';
  } catch {
    return '';
  }
}

export async function uploadImgBbAvatar(file, options = {}) {
  const apiKey = options.apiKey ?? config.storage.imgbbApiKey;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? config.storage.imgbbUploadTimeoutMs;
  const extension = options.extension || '.jpg';

  if (!apiKey) throw new ApiError(503, 'ImgBB avatar storage is not configured', 'STORAGE_CONFIGURATION_ERROR');
  if (typeof fetchImpl !== 'function') throw new ApiError(503, 'Image hosting is unavailable', 'STORAGE_CONFIGURATION_ERROR');

  const endpoint = new URL('https://api.imgbb.com/1/upload');
  endpoint.searchParams.set('key', apiKey);
  const form = new FormData();
  form.append('image', new Blob([file.buffer], { type: file.mimetype }), `${crypto.randomUUID()}${extension}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', body: form, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    const imageUrl = trustedImgBbUrl(payload?.data?.url);
    const deleteUrl = trustedImgBbUrl(payload?.data?.delete_url);
    if (!response.ok || payload?.success !== true || !imageUrl || !deleteUrl) {
      throw new ApiError(502, 'Image hosting rejected the profile photo', 'AVATAR_STORAGE_ERROR');
    }
    return { url: imageUrl, storageKey: deleteUrl, provider: 'imgbb' };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Image hosting is temporarily unavailable', 'AVATAR_STORAGE_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

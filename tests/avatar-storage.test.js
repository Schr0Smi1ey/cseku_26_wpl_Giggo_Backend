import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';

const { uploadImgBbAvatar } = await import('../src/integrations/storage/imgbb-avatar.js');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZQAAAAASUVORK5CYII=', 'base64');
const file = { buffer: png, mimetype: 'image/png' };

test('ImgBB adapter uploads multipart image data and returns trusted URLs', async () => {
  const fetchImpl = async (endpoint, options) => {
    assert.equal(endpoint.origin, 'https://api.imgbb.com');
    assert.equal(endpoint.pathname, '/1/upload');
    assert.equal(endpoint.searchParams.get('key'), 'test-api-key');
    assert.equal(options.method, 'POST');
    const image = options.body.get('image');
    assert.equal(image.type, 'image/png');
    assert.match(image.name, /^[0-9a-f-]+\.png$/i);
    return new Response(JSON.stringify({
      success: true,
      data: {
        url: 'https://i.ibb.co/example/avatar.png',
        delete_url: 'https://ibb.co/example/private-delete-token',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const stored = await uploadImgBbAvatar(file, {
    apiKey: 'test-api-key',
    extension: '.png',
    fetchImpl,
    timeoutMs: 1000,
  });
  assert.equal(stored.url, 'https://i.ibb.co/example/avatar.png');
  assert.equal(stored.storageKey, 'https://ibb.co/example/private-delete-token');
  assert.equal(stored.provider, 'imgbb');
});

test('ImgBB adapter returns a safe error for rejected or untrusted responses', async () => {
  const rejectedFetch = async () => new Response(JSON.stringify({ success: false }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(
    uploadImgBbAvatar(file, { apiKey: 'secret-that-must-not-leak', fetchImpl: rejectedFetch, timeoutMs: 1000 }),
    (error) => error.code === 'AVATAR_STORAGE_ERROR' && !error.message.includes('secret-that-must-not-leak'),
  );

  const untrustedFetch = async () => new Response(JSON.stringify({
    success: true,
    data: { url: 'https://attacker.example/avatar.png', delete_url: 'https://ibb.co/delete/token' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    uploadImgBbAvatar(file, { apiKey: 'test-api-key', fetchImpl: untrustedFetch, timeoutMs: 1000 }),
    (error) => error.code === 'AVATAR_STORAGE_ERROR',
  );
});

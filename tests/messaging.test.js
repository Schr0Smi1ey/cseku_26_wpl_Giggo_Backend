import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://giggo-test.supabase.co';

const { createApp } = await import('../src/app.js');
const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { Conversation } = await import('../src/models/Conversation.js');
const { Message } = await import('../src/models/Message.js');
const { Notification } = await import('../src/models/Notification.js');
const { NotificationPreference } = await import('../src/models/NotificationPreference.js');
const { SavedMessage } = await import('../src/models/SavedMessage.js');
const { User } = await import('../src/models/User.js');
const { createRealtimeServer } = await import('../src/sockets/index.js');
const { setSupabaseTokenVerifierForTests } = await import('../src/services/supabase-auth.service.js');

const claims = new Map();
setSupabaseTokenVerifierForTests(async (token) => {
  if (!claims.has(token)) throw new Error('Unknown test token');
  return claims.get(token);
});

const app = createApp();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (id, role = 'freelancer') => {
  const token = `message-token-${id}`;
  claims.set(token, {
    sub: id,
    email: `${id}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { name: id, signup_role: role },
  });
  return token;
};

before(async () => connectDB());
beforeEach(async () => {
  claims.clear();
  await Promise.all([
    SavedMessage.deleteMany({}),
    NotificationPreference.deleteMany({}),
    Notification.deleteMany({}),
    Message.deleteMany({}),
    Conversation.deleteMany({}),
    User.deleteMany({}),
  ]);
});
after(async () => disconnectDB());

async function users() {
  const clientToken = tokenFor('message-client', 'client');
  const freelancerToken = tokenFor('message-freelancer');
  const outsiderToken = tokenFor('message-outsider');
  await Promise.all([
    request(app).get('/api/auth/me').set(auth(clientToken)).expect(200),
    request(app).get('/api/auth/me').set(auth(freelancerToken)).expect(200),
    request(app).get('/api/auth/me').set(auth(outsiderToken)).expect(200),
  ]);
  const [client, freelancer, outsider] = await Promise.all([
    User.findOne({ supabaseUserId: 'message-client' }),
    User.findOne({ supabaseUserId: 'message-freelancer' }),
    User.findOne({ supabaseUserId: 'message-outsider' }),
  ]);
  return { clientToken, freelancerToken, outsiderToken, client, freelancer, outsider };
}

test('private conversations enforce membership, deduplicate sends, and maintain unread state', async () => {
  const { clientToken, freelancerToken, outsiderToken, freelancer } = await users();
  const [first, second] = await Promise.all([
    request(app).post('/api/conversations').set(auth(clientToken)).send({ participantIds: [String(freelancer._id)] }),
    request(app).post('/api/conversations').set(auth(clientToken)).send({ participantIds: [String(freelancer._id)] }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const conversationId = first.body.data.conversation._id;
  assert.equal(second.body.data.conversation._id, conversationId);
  assert.equal(await Conversation.countDocuments({ type: 'direct' }), 1);

  await request(app).get(`/api/conversations/${conversationId}`).set(auth(outsiderToken)).expect(404);
  const payload = { body: 'Hello from the client', clientMessageId: 'message-client-id-0001', replyTo: null };
  const sent = await request(app).post(`/api/conversations/${conversationId}/messages`).set(auth(clientToken)).send(payload).expect(201);
  const duplicate = await request(app).post(`/api/conversations/${conversationId}/messages`).set(auth(clientToken)).send(payload).expect(201);
  assert.equal(duplicate.body.data.message._id, sent.body.data.message._id);
  assert.equal(await Message.countDocuments({ conversation: conversationId }), 1);
  assert.equal(await Notification.countDocuments({ recipient: freelancer._id, type: 'message_received' }), 1);

  const unread = await request(app).get('/api/conversations').set(auth(freelancerToken)).expect(200);
  assert.equal(unread.body.data.items[0].unreadCount, 1);
  await request(app).post(`/api/conversations/${conversationId}/read`).set(auth(freelancerToken)).expect(200);
  const read = await request(app).get('/api/conversations').set(auth(freelancerToken)).expect(200);
  assert.equal(read.body.data.items[0].unreadCount, 0);
  const notification = await Notification.findOne({ recipient: freelancer._id, type: 'message_received' }).lean();
  assert.ok(notification.readAt);
  const notificationList = await request(app).get('/api/notifications').set(auth(freelancerToken)).expect(200);
  assert.equal(notificationList.body.data.unreadCount, 0);
});

test('participants can reply, search, edit, react, pin, save, and delete messages', async () => {
  const { clientToken, freelancerToken, freelancer } = await users();
  const created = await request(app).post('/api/conversations').set(auth(clientToken)).send({ participantIds: [String(freelancer._id)] }).expect(201);
  const conversationId = created.body.data.conversation._id;
  const original = await request(app).post(`/api/conversations/${conversationId}/messages`).set(auth(clientToken)).send({ body: 'Searchable project requirements', clientMessageId: 'message-client-id-0002' }).expect(201);
  const messageId = original.body.data.message._id;
  const reply = await request(app).post(`/api/conversations/${conversationId}/messages`).set(auth(freelancerToken)).send({ body: 'I have reviewed them', clientMessageId: 'message-client-id-0003', replyTo: messageId }).expect(201);
  assert.equal(reply.body.data.message.replyTo._id, messageId);

  await request(app).patch(`/api/conversations/messages/${messageId}`).set(auth(clientToken)).send({ body: 'Updated searchable project requirements' }).expect(200);
  await request(app).post(`/api/conversations/messages/${messageId}/reaction`).set(auth(freelancerToken)).send({ emoji: '👍' }).expect(200);
  await request(app).post(`/api/conversations/messages/${messageId}/pin`).set(auth(freelancerToken)).expect(200);
  await request(app).post(`/api/conversations/messages/${messageId}/save`).set(auth(freelancerToken)).expect(200);

  const search = await request(app).get(`/api/conversations/${conversationId}/messages?search=updated`).set(auth(freelancerToken)).expect(200);
  assert.equal(search.body.data.items.length, 1);
  const pinned = await request(app).get(`/api/conversations/${conversationId}/messages?pinned=true`).set(auth(freelancerToken)).expect(200);
  assert.equal(pinned.body.data.items.length, 1);
  const saved = await request(app).get(`/api/conversations/${conversationId}/messages?saved=true`).set(auth(freelancerToken)).expect(200);
  assert.equal(saved.body.data.items[0].savedByMe, true);

  await request(app).delete(`/api/conversations/messages/${messageId}`).set(auth(clientToken)).expect(200);
  const history = await request(app).get(`/api/conversations/${conversationId}/messages`).set(auth(freelancerToken)).expect(200);
  assert.equal(history.body.data.items[0].deletedAt !== null, true);
  assert.equal(history.body.data.items[0].body, '');
});

test('notification preferences suppress disabled categories and notification actions stay user-scoped', async () => {
  const { clientToken, freelancerToken, outsiderToken, freelancer } = await users();
  await request(app).get('/api/notifications/preferences/me').set(auth(freelancerToken)).expect(200);
  const categories = ['messages', 'proposals', 'offers', 'contracts', 'payments', 'disputes', 'verification', 'system'];
  await request(app).patch('/api/notifications/preferences/me').set(auth(freelancerToken)).send({ inApp: Object.fromEntries(categories.map((category) => [category, category !== 'messages'])) }).expect(200);
  const created = await request(app).post('/api/conversations').set(auth(clientToken)).send({ participantIds: [String(freelancer._id)] }).expect(201);
  await request(app).post(`/api/conversations/${created.body.data.conversation._id}/messages`).set(auth(clientToken)).send({ body: 'No notification should be created', clientMessageId: 'message-client-id-0004' }).expect(201);
  assert.equal(await Notification.countDocuments({ recipient: freelancer._id }), 0);

  await NotificationPreference.deleteMany({ user: freelancer._id });
  await request(app).post(`/api/conversations/${created.body.data.conversation._id}/messages`).set(auth(clientToken)).send({ body: 'This notification should exist', clientMessageId: 'message-client-id-0005' }).expect(201);
  const listed = await request(app).get('/api/notifications').set(auth(freelancerToken)).expect(200);
  const notificationId = listed.body.data.items[0]._id;
  await request(app).patch(`/api/notifications/${notificationId}/read`).set(auth(outsiderToken)).expect(404);
  await request(app).patch(`/api/notifications/${notificationId}/read`).set(auth(freelancerToken)).expect(200);
});

test('group owners manage participants while ordinary members cannot', async () => {
  const { clientToken, freelancerToken, outsiderToken, freelancer, outsider } = await users();
  const fourthToken = tokenFor('message-fourth');
  await request(app).get('/api/auth/me').set(auth(fourthToken)).expect(200);
  const fourth = await User.findOne({ supabaseUserId: 'message-fourth' });
  const created = await request(app).post('/api/conversations').set(auth(clientToken)).send({
    participantIds: [String(freelancer._id), String(outsider._id)],
    title: 'Delivery group',
  }).expect(201);
  const conversationId = created.body.data.conversation._id;
  await request(app).delete(`/api/conversations/${conversationId}/participants/${outsider._id}`).set(auth(freelancerToken)).expect(403);
  await request(app).post(`/api/conversations/${conversationId}/participants`).set(auth(clientToken)).send({ userId: String(fourth._id) }).expect(200);
  await request(app).delete(`/api/conversations/${conversationId}/participants/${outsider._id}`).set(auth(clientToken)).expect(200);
  await request(app).get(`/api/conversations/${conversationId}`).set(auth(outsiderToken)).expect(404);
  await request(app).get(`/api/conversations/${conversationId}`).set(auth(fourthToken)).expect(200);
});

test('authenticated sockets receive live messages only after an authorized room join', async () => {
  const { clientToken, freelancerToken, freelancer } = await users();
  const created = await request(app).post('/api/conversations').set(auth(clientToken)).send({ participantIds: [String(freelancer._id)] }).expect(201);
  const conversationId = created.body.data.conversation._id;
  const server = http.createServer(app);
  const io = createRealtimeServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const socket = connectSocket(`http://127.0.0.1:${port}`, { auth: { token: freelancerToken }, transports: ['websocket'] });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const joined = await new Promise((resolve) => socket.emit('conversation:join', { conversationId }, resolve));
    assert.equal(joined.success, true);
    const incoming = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for live message')), 2000);
      socket.once('message:new', (payload) => { clearTimeout(timer); resolve(payload); });
    });
    await request(app).post(`/api/conversations/${conversationId}/messages`).set(auth(clientToken)).send({ body: 'Delivered in real time', clientMessageId: 'message-client-id-0006' }).expect(201);
    const event = await incoming;
    assert.equal(event.conversationId, conversationId);
    assert.equal(event.message.body, 'Delivered in real time');
  } finally {
    socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

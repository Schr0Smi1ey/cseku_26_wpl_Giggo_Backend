import { Server } from 'socket.io';
import { config } from '../config/index.js';
import { Conversation } from '../models/Conversation.js';
import { conversationService, ensureConversationMember } from '../services/conversation.service.js';
import { setRealtimeServer } from '../services/realtime.service.js';
import { syncSupabaseUser, verifySupabaseAccessToken } from '../services/supabase-auth.service.js';

const connectionCounts = new Map();

const online = (userId) => (connectionCounts.get(String(userId)) || 0) > 0;

function runBackground(task, label) {
  void task.catch((error) => {
    // Shutdown can close MongoDB before Socket.IO finishes its disconnect
    // callbacks. That expected race must not become an unhandled rejection.
    if (error?.name === 'MongoClientClosedError') return;
    console.error('Realtime background task failed', {
      label,
      errorName: error?.name,
      errorCode: error?.code,
    });
  });
}

async function broadcastPresence(io, userId, isOnline) {
  const conversationIds = await Conversation.find({ participantIds: userId }).distinct('_id');
  for (const conversationId of conversationIds) {
    io.to(`conversation:${conversationId}`).emit('presence:update', { userId: String(userId), online: isOnline });
  }
}

async function authorizedConversation(userId, conversationId) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;
  try {
    ensureConversationMember(conversation, userId);
    return conversation;
  } catch {
    return null;
  }
}

export function createRealtimeServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const identity = await verifySupabaseAccessToken(token);
      socket.data.user = await syncSupabaseUser(identity);
      return next();
    } catch {
      return next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.data.user._id);
    const previous = connectionCounts.get(userId) || 0;
    connectionCounts.set(userId, previous + 1);
    socket.join(`user:${userId}`);
    if (previous === 0) runBackground(broadcastPresence(io, userId, true), 'presence-online');

    socket.on('conversation:join', async ({ conversationId } = {}, acknowledge) => {
      const conversation = await authorizedConversation(userId, conversationId);
      if (!conversation) return acknowledge?.({ success: false, message: 'Conversation not found' });
      socket.join(`conversation:${conversationId}`);
      const participantPresence = Object.fromEntries(conversation.participantIds.map((id) => [String(id), online(id)]));
      return acknowledge?.({ success: true, presence: participantPresence });
    });

    socket.on('conversation:leave', ({ conversationId } = {}) => socket.leave(`conversation:${conversationId}`));

    const typing = async (event, { conversationId } = {}) => {
      const conversation = await authorizedConversation(userId, conversationId);
      if (!conversation || !socket.rooms.has(`conversation:${conversationId}`)) return;
      socket.to(`conversation:${conversationId}`).emit(event, { conversationId, userId });
    };
    socket.on('typing:start', (payload) => runBackground(typing('typing:start', payload), 'typing-start'));
    socket.on('typing:stop', (payload) => runBackground(typing('typing:stop', payload), 'typing-stop'));

    socket.on('conversation:read', async ({ conversationId } = {}, acknowledge) => {
      try {
        await conversationService.markRead(socket.data.user, conversationId);
        acknowledge?.({ success: true });
      } catch (error) {
        acknowledge?.({ success: false, message: error.message });
      }
    });

    socket.on('disconnect', () => {
      const next = Math.max(0, (connectionCounts.get(userId) || 1) - 1);
      if (next === 0) {
        connectionCounts.delete(userId);
        runBackground(broadcastPresence(io, userId, false), 'presence-offline');
      } else connectionCounts.set(userId, next);
    });
  });

  setRealtimeServer(io);
  return io;
}

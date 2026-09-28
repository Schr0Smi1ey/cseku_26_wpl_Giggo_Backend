let ioInstance = null;

export function setRealtimeServer(io) {
  ioInstance = io;
}

export function emitToConversation(conversationId, event, payload) {
  ioInstance?.to(`conversation:${conversationId}`).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  ioInstance?.to(`user:${userId}`).emit(event, payload);
}

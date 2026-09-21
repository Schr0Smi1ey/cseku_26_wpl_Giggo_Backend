import { conversationService } from '../services/conversation.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const conversationController = {
  contacts: asyncHandler(async (req, res) => ok(res, { items: await conversationService.contacts(req.user, req.query.search) })),
  create: asyncHandler(async (req, res) => ok(res, { conversation: await conversationService.create(req.user, req.body) }, 'Conversation ready', 201)),
  list: asyncHandler(async (req, res) => ok(res, await conversationService.list(req.user, req.query))),
  get: asyncHandler(async (req, res) => ok(res, { conversation: await conversationService.get(req.user, req.params.conversationId) })),
  messages: asyncHandler(async (req, res) => ok(res, await conversationService.listMessages(req.user, req.params.conversationId, req.query))),
  send: asyncHandler(async (req, res) => ok(res, { message: await conversationService.send(req.user, req.params.conversationId, req.body) }, 'Message sent', 201)),
  read: asyncHandler(async (req, res) => ok(res, await conversationService.markRead(req.user, req.params.conversationId), 'Conversation marked as read')),
  edit: asyncHandler(async (req, res) => ok(res, { message: await conversationService.edit(req.user, req.params.messageId, req.body.body) }, 'Message edited')),
  remove: asyncHandler(async (req, res) => ok(res, { message: await conversationService.remove(req.user, req.params.messageId) }, 'Message deleted')),
  react: asyncHandler(async (req, res) => ok(res, { message: await conversationService.react(req.user, req.params.messageId, req.body.emoji) }, 'Reaction updated')),
  pin: asyncHandler(async (req, res) => ok(res, { message: await conversationService.togglePin(req.user, req.params.messageId) }, 'Pin updated')),
  save: asyncHandler(async (req, res) => ok(res, await conversationService.toggleSave(req.user, req.params.messageId), 'Saved-message status updated')),
  settings: asyncHandler(async (req, res) => ok(res, { conversation: await conversationService.updateMySettings(req.user, req.params.conversationId, req.body) }, 'Conversation settings updated')),
  addParticipant: asyncHandler(async (req, res) => ok(res, { conversation: await conversationService.addParticipant(req.user, req.params.conversationId, req.body.userId) }, 'Participant added')),
  removeParticipant: asyncHandler(async (req, res) => ok(res, { conversation: await conversationService.removeParticipant(req.user, req.params.conversationId, req.params.userId) }, 'Participant removed')),
};

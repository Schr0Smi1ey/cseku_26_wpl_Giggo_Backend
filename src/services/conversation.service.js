import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Notification } from '../models/Notification.js';
import { Offer } from '../models/Offer.js';
import { SavedMessage } from '../models/SavedMessage.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { containsExternalContact } from '../utils/contact-policy.js';
import { notificationService } from './notification.service.js';
import { emitToConversation, emitToUser } from './realtime.service.js';

const USER_SELECT = 'name avatar role roles status lastActiveAt';
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

const valueId = (value) => String(value?._id || value);
const directKey = (values) => values.map(valueId).sort().join(':');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function participant(conversation, userId) {
  return conversation.participants.find((item) => valueId(item.user) === valueId(userId));
}

export function ensureConversationMember(conversation, userId) {
  const member = participant(conversation, userId);
  if (!member) throw ApiError.notFound('Conversation not found');
  return member;
}

function ensureActive(conversation) {
  if (conversation.status !== 'active') throw ApiError.badRequest('This conversation is closed');
}

async function ensureMessageWriteAllowed(conversation, body = '') {
  ensureActive(conversation);
  if (conversation.type !== 'offer') return;
  const offer = await Offer.findById(conversation.contextId).select('status sentAt');
  if (!offer || !offer.sentAt || ['rejected', 'withdrawn'].includes(offer.status)) {
    throw ApiError.badRequest('This negotiation is closed');
  }
  if (offer.status !== 'accepted' && containsExternalContact(body)) {
    throw ApiError.badRequest('Keep contact details on Giggo until the offer is accepted');
  }
}

async function populatedConversation(id) {
  return Conversation.findById(id)
    .populate('participants.user', USER_SELECT)
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: USER_SELECT } });
}

async function presentConversation(conversation, userId) {
  const item = conversation.toObject?.() || conversation;
  const member = item.participants.find((entry) => valueId(entry.user) === valueId(userId));
  const unreadFilter = {
    conversation: item._id,
    sender: mongoose.trusted({ $ne: userId }),
    deletedAt: null,
  };
  if (member?.lastReadMessage) unreadFilter._id = mongoose.trusted({ $gt: member.lastReadMessage });
  else unreadFilter.createdAt = mongoose.trusted({ $gte: member?.joinedAt || item.createdAt });
  const unreadCount = await Message.countDocuments(unreadFilter);
  return { ...item, unreadCount, mySettings: member || null };
}

async function conversationAndMessage(user, messageId) {
  const message = await Message.findById(messageId);
  if (!message) throw ApiError.notFound('Message not found');
  const conversation = await Conversation.findById(message.conversation);
  if (!conversation) throw ApiError.notFound('Conversation not found');
  ensureConversationMember(conversation, user._id);
  return { conversation, message };
}

async function populateMessage(message) {
  return Message.findById(message._id)
    .populate('sender', USER_SELECT)
    .populate({ path: 'replyTo', select: 'sender body deletedAt', populate: { path: 'sender', select: USER_SELECT } });
}

export const conversationService = {
  async contacts(user, search = '') {
    const filter = { _id: { $ne: user._id }, status: 'active' };
    if (search) filter.name = new RegExp(escapeRegex(search), 'i');
    return User.find(filter).select(USER_SELECT).sort({ name: 1 }).limit(20).lean();
  },

  async create(user, { participantIds, title = '' }) {
    const uniqueIds = [...new Set([valueId(user._id), ...participantIds])];
    if (uniqueIds.length < 2) throw ApiError.badRequest('Choose at least one other participant');
    if (uniqueIds.length > 20) throw ApiError.badRequest('A conversation can have at most 20 participants');
    const users = await User.find({ _id: mongoose.trusted({ $in: uniqueIds }), status: 'active' }).select('_id');
    if (users.length !== uniqueIds.length) throw ApiError.badRequest('One or more participants are unavailable');
    const type = uniqueIds.length === 2 ? 'direct' : 'group';
    if (type === 'group' && title.trim().length < 2) throw ApiError.badRequest('Group conversations need a title');
    const key = type === 'direct' ? directKey(uniqueIds) : null;
    if (key) {
      const existing = await Conversation.findOne({ directKey: key });
      if (existing) return presentConversation(await populatedConversation(existing._id), user._id);
    }
    let conversation;
    try {
      conversation = await Conversation.create({
        type,
        title: type === 'group' ? title : '',
        createdBy: user._id,
        participantIds: uniqueIds,
        participants: uniqueIds.map((userId) => ({ user: userId, role: userId === valueId(user._id) ? 'owner' : 'member' })),
        directKey: key,
      });
    } catch (error) {
      if (error?.code !== 11000 || !key) throw error;
      conversation = await Conversation.findOne({ directKey: key });
      if (!conversation) throw error;
    }
    const populated = await populatedConversation(conversation._id);
    for (const userId of uniqueIds) {
      if (userId !== valueId(user._id)) emitToUser(userId, 'conversation:new', { conversation: await presentConversation(populated, userId) });
    }
    return presentConversation(populated, user._id);
  },

  async list(user, { cursor, limit = 20, search = '' } = {}) {
    const filter = { participantIds: user._id };
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const matchingUsers = await User.find({ name: regex, status: 'active' }).limit(100).distinct('_id');
      filter.$or = mongoose.trusted([{ title: regex }, { participantIds: { $in: matchingUsers } }]);
    }
    if (cursor) {
      const [timestamp, cursorId] = cursor.split('_');
      const activityAt = new Date(Number(timestamp));
      filter.$and = [{ $or: [
        { activityAt: { $lt: activityAt } },
        { activityAt, _id: { $lt: cursorId } },
      ] }];
    }
    const conversations = await Conversation.find(mongoose.trusted(filter))
      .sort({ activityAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('participants.user', USER_SELECT)
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: USER_SELECT } });
    const hasMore = conversations.length > limit;
    if (hasMore) conversations.pop();
    const presented = await Promise.all(conversations.map((item) => presentConversation(item, user._id)));
    const last = conversations.at(-1);
    return { items: presented, nextCursor: hasMore && last ? `${new Date(last.activityAt).getTime()}_${valueId(last)}` : null };
  },

  async get(user, conversationId) {
    const conversation = await populatedConversation(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    ensureConversationMember(conversation, user._id);
    return presentConversation(conversation, user._id);
  },

  async listMessages(user, conversationId, { cursor, limit = 30, search = '', pinned = false, saved = false } = {}) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    ensureConversationMember(conversation, user._id);
    const filter = { conversation: conversation._id };
    if (cursor) filter._id = { $lt: cursor };
    if (search) filter.body = new RegExp(escapeRegex(search), 'i');
    if (pinned) filter.pinnedBy = user._id;
    if (saved) {
      const savedIds = await SavedMessage.find({ user: user._id }).distinct('message');
      filter._id = mongoose.trusted({ ...(filter._id || {}), $in: savedIds });
    }
    const items = await Message.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('sender', USER_SELECT)
      .populate({ path: 'replyTo', select: 'sender body deletedAt', populate: { path: 'sender', select: USER_SELECT } })
      .lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const savedIds = new Set((await SavedMessage.find({ user: user._id, message: mongoose.trusted({ $in: items.map((item) => item._id) }) }).distinct('message')).map(valueId));
    return {
      items: items.reverse().map((item) => ({ ...item, savedByMe: savedIds.has(valueId(item)) })),
      nextCursor: hasMore ? valueId(items[0]) : null,
    };
  },

  async send(user, conversationId, { body, clientMessageId, replyTo = null, metadata = {} }) {
    await Message.init();
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    const member = ensureConversationMember(conversation, user._id);
    await ensureMessageWriteAllowed(conversation, body);
    if (member.archivedAt) member.archivedAt = null;
    if (replyTo && !await Message.exists({ _id: replyTo, conversation: conversation._id })) {
      throw ApiError.badRequest('The replied message is not in this conversation');
    }
    let message;
    try {
      message = await Message.create({ conversation: conversation._id, sender: user._id, body, clientMessageId, replyTo, metadata });
    } catch (error) {
      if (error?.code !== 11000 || !clientMessageId) throw error;
      message = await Message.findOne({ conversation: conversation._id, sender: user._id, clientMessageId });
      return populateMessage(message);
    }
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = message.createdAt;
    conversation.activityAt = message.createdAt;
    member.lastReadAt = message.createdAt;
    member.lastReadMessage = message._id;
    await conversation.save();
    const populated = await populateMessage(message);
    emitToConversation(conversation._id, 'message:new', { conversationId: valueId(conversation), message: populated });
    const recipients = conversation.participantIds.filter((item) => valueId(item) !== valueId(user._id));
    await Promise.all(recipients.map((recipient) => notificationService.publish({
      recipient,
      actor: user._id,
      eventKey: `message:${message._id}`,
      type: 'message_received',
      category: 'messages',
      title: `${user.name} sent you a message`,
      body: body.slice(0, 160),
      actionUrl: `/dashboard/messages?conversation=${conversation._id}`,
      entityType: 'conversation',
      entityId: conversation._id,
      metadata: { messageId: message._id },
    })));
    return populated;
  },

  async markRead(user, conversationId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    const member = ensureConversationMember(conversation, user._id);
    const latest = await Message.findOne({ conversation: conversation._id }).sort({ _id: -1 }).select('_id createdAt');
    const readAt = new Date();
    member.lastReadAt = readAt;
    member.lastReadMessage = latest?._id || null;
    await conversation.save();

    const notificationTargets = [
      { entityType: 'conversation', entityId: conversation._id },
    ];
    if (conversation.contextType === 'offer' && conversation.contextId) {
      notificationTargets.push({
        entityType: 'offer',
        entityId: conversation.contextId,
        type: 'offer_message_received',
      });
    }
    await Notification.updateMany(
      mongoose.trusted({
        recipient: user._id,
        readAt: null,
        $or: notificationTargets,
      }),
      { $set: { readAt } },
    );
    emitToConversation(conversation._id, 'message:read', { conversationId: valueId(conversation), userId: valueId(user) });
    return { readAt: member.lastReadAt, lastReadMessage: member.lastReadMessage };
  },

  async edit(user, messageId, body) {
    const { conversation, message } = await conversationAndMessage(user, messageId);
    await ensureMessageWriteAllowed(conversation, body);
    if (valueId(message.sender) !== valueId(user)) throw ApiError.forbidden('Only the sender can edit this message');
    if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be edited');
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) throw ApiError.badRequest('Messages can only be edited for 15 minutes');
    message.body = body;
    message.editedAt = new Date();
    await message.save();
    const populated = await populateMessage(message);
    emitToConversation(conversation._id, 'message:updated', { conversationId: valueId(conversation), message: populated });
    return populated;
  },

  async remove(user, messageId) {
    const { conversation, message } = await conversationAndMessage(user, messageId);
    await ensureMessageWriteAllowed(conversation);
    const isOwner = participant(conversation, user._id)?.role === 'owner';
    if (valueId(message.sender) !== valueId(user) && !isOwner) throw ApiError.forbidden('You cannot delete this message');
    if (Date.now() - message.createdAt.getTime() > DELETE_WINDOW_MS && !isOwner) throw ApiError.badRequest('Messages can only be deleted for one hour');
    message.body = '';
    message.deletedAt = new Date();
    message.reactions = [];
    message.pinnedBy = [];
    await message.save();
    await SavedMessage.deleteMany({ message: message._id });
    emitToConversation(conversation._id, 'message:updated', { conversationId: valueId(conversation), message });
    return message;
  },

  async react(user, messageId, emoji) {
    const { conversation, message } = await conversationAndMessage(user, messageId);
    await ensureMessageWriteAllowed(conversation);
    if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be reacted to');
    message.reactions = message.reactions.filter((item) => valueId(item.user) !== valueId(user));
    if (emoji) message.reactions.push({ user: user._id, emoji });
    await message.save();
    const populated = await populateMessage(message);
    emitToConversation(conversation._id, 'message:updated', { conversationId: valueId(conversation), message: populated });
    return populated;
  },

  async togglePin(user, messageId) {
    const { conversation, message } = await conversationAndMessage(user, messageId);
    if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be pinned');
    const already = message.pinnedBy.some((item) => valueId(item) === valueId(user));
    message.pinnedBy = already ? message.pinnedBy.filter((item) => valueId(item) !== valueId(user)) : [...message.pinnedBy, user._id];
    await message.save();
    const populated = await populateMessage(message);
    emitToConversation(conversation._id, 'message:updated', { conversationId: valueId(conversation), message: populated });
    return populated;
  },

  async toggleSave(user, messageId) {
    await SavedMessage.init();
    await conversationAndMessage(user, messageId);
    const existing = await SavedMessage.findOne({ user: user._id, message: messageId });
    if (existing) {
      await existing.deleteOne();
      return { saved: false };
    }
    try {
      await SavedMessage.create({ user: user._id, message: messageId });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    return { saved: true };
  },

  async updateMySettings(user, conversationId, patch) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    const member = ensureConversationMember(conversation, user._id);
    if (typeof patch.muted === 'boolean') member.muted = patch.muted;
    if (typeof patch.archived === 'boolean') member.archivedAt = patch.archived ? new Date() : null;
    await conversation.save();
    return presentConversation(await populatedConversation(conversation._id), user._id);
  },

  async addParticipant(user, conversationId, newUserId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    const member = ensureConversationMember(conversation, user._id);
    if (conversation.type !== 'group' || member.role !== 'owner') throw ApiError.forbidden('Only a group owner can add participants');
    if (conversation.participantIds.some((item) => valueId(item) === valueId(newUserId))) return this.get(user, conversationId);
    if (conversation.participantIds.length >= 20) throw ApiError.badRequest('A conversation can have at most 20 participants');
    if (!await User.exists({ _id: newUserId, status: 'active' })) throw ApiError.badRequest('Participant is unavailable');
    conversation.participantIds.push(newUserId);
    conversation.participants.push({ user: newUserId, role: 'member' });
    await conversation.save();
    emitToUser(newUserId, 'conversation:new', { conversation: await presentConversation(await populatedConversation(conversation._id), newUserId) });
    emitToConversation(conversation._id, 'conversation:updated', { conversationId: valueId(conversation) });
    return this.get(user, conversationId);
  },

  async removeParticipant(user, conversationId, targetUserId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw ApiError.notFound('Conversation not found');
    const member = ensureConversationMember(conversation, user._id);
    if (conversation.type !== 'group') throw ApiError.badRequest('Direct conversation participants cannot be changed');
    const isSelf = valueId(user) === valueId(targetUserId);
    if (!isSelf && member.role !== 'owner') throw ApiError.forbidden('Only a group owner can remove participants');
    if (valueId(conversation.createdBy) === valueId(targetUserId)) throw ApiError.badRequest('The group owner cannot leave without transferring ownership');
    conversation.participantIds = conversation.participantIds.filter((item) => valueId(item) !== valueId(targetUserId));
    conversation.participants = conversation.participants.filter((item) => valueId(item.user) !== valueId(targetUserId));
    await conversation.save();
    emitToUser(targetUserId, 'conversation:removed', { conversationId: valueId(conversation) });
    emitToConversation(conversation._id, 'conversation:updated', { conversationId: valueId(conversation) });
    return this.get(user, conversationId);
  },
};

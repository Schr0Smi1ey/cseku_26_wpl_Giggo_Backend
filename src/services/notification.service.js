import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { NOTIFICATION_CATEGORIES, NotificationPreference } from '../models/NotificationPreference.js';
import { ApiError } from '../utils/ApiError.js';
import { emitToUser } from './realtime.service.js';

const id = (value) => value?._id || value;

async function categoryEnabled(userId, category) {
  const preference = await NotificationPreference.findOne({ user: userId }).lean();
  if (!preference) return true;
  const values = preference.inApp instanceof Map ? Object.fromEntries(preference.inApp) : preference.inApp;
  return values?.[category] !== false;
}

export const notificationService = {
  async publish({ recipient, actor = null, eventKey = null, type, category = 'system', title, body = '', actionUrl = '', entityType = '', entityId = null, metadata = {} }) {
    await Notification.init();
    if (!await categoryEnabled(recipient, category)) return null;
    const values = { recipient, actor, eventKey, type, category, title, body, actionUrl, entityType, entityId, metadata };
    let notification;
    try {
      notification = eventKey
        ? await Notification.findOneAndUpdate(
          { recipient, eventKey },
          { $setOnInsert: values },
          { upsert: true, new: true, runValidators: true },
        )
        : await Notification.create(values);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      notification = await Notification.findOne({ recipient, eventKey });
    }
    if (notification) emitToUser(recipient, 'notification:new', { notification });
    return notification;
  },

  async list(user, { cursor, limit = 20, unreadOnly = false } = {}) {
    const filter = { recipient: user._id, archivedAt: null };
    if (cursor) filter._id = { $lt: cursor };
    if (unreadOnly) filter.readAt = null;
    const items = await Notification.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('actor', 'name avatar role')
      .lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const unreadCount = await Notification.countDocuments({ recipient: user._id, archivedAt: null, readAt: null });
    return { items, unreadCount, nextCursor: hasMore ? String(items.at(-1)._id) : null };
  },

  async markRead(user, notificationId) {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: user._id, archivedAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!notification) throw ApiError.notFound('Notification not found');
    return notification;
  },

  async markAllRead(user) {
    const result = await Notification.updateMany(
      { recipient: user._id, archivedAt: null, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { updated: result.modifiedCount };
  },

  async archive(user, notificationId) {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: user._id },
      { $set: { archivedAt: new Date() } },
      { new: true },
    );
    if (!notification) throw ApiError.notFound('Notification not found');
    return notification;
  },

  async getPreferences(user) {
    return NotificationPreference.findOneAndUpdate(
      { user: user._id },
      { $setOnInsert: { user: user._id } },
      { upsert: true, new: true, runValidators: true },
    );
  },

  async updatePreferences(user, inApp) {
    const safe = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, inApp[category]]));
    return NotificationPreference.findOneAndUpdate(
      { user: user._id },
      { $set: { inApp: safe }, $setOnInsert: { user: user._id } },
      { upsert: true, new: true, runValidators: true },
    );
  },
};

export function trustedIds(values) {
  return mongoose.trusted({ $in: values.map(id) });
}

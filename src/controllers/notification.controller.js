import { notificationService } from '../services/notification.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const notificationController = {
  list: asyncHandler(async (req, res) => ok(res, await notificationService.list(req.user, req.query))),
  read: asyncHandler(async (req, res) => ok(res, { notification: await notificationService.markRead(req.user, req.params.id) }, 'Notification marked as read')),
  readAll: asyncHandler(async (req, res) => ok(res, await notificationService.markAllRead(req.user), 'Notifications marked as read')),
  archive: asyncHandler(async (req, res) => ok(res, { notification: await notificationService.archive(req.user, req.params.id) }, 'Notification archived')),
  preferences: asyncHandler(async (req, res) => ok(res, { preferences: await notificationService.getPreferences(req.user) })),
  updatePreferences: asyncHandler(async (req, res) => ok(res, { preferences: await notificationService.updatePreferences(req.user, req.body.inApp) }, 'Notification preferences updated')),
};

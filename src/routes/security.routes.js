import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { SecuritySession, SecurityEvent } from '../models/SecuritySession.js';
import { requireAuth } from '../middlewares/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const [sessions, events] = await Promise.all([SecuritySession.find({ user: req.user._id, expiresAt: mongoose.trusted({ $gt: new Date() }) }).select('-sessionHash').sort({ lastSeenAt: -1 }).limit(50).lean(), SecurityEvent.find({ user: req.user._id, at: mongoose.trusted({ $gte: cutoff }) }).sort({ at: -1 }).limit(100).lean()]);
  return ok(res, { sessions: sessions.map(s => ({ ...s, current: String(s._id) === String(req.securitySessionId) })), events, retentionDays: 30 });
}));
router.post('/sessions/:id/revoke', asyncHandler(async (req, res) => {
  z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
  let result;
  await mongoose.connection.transaction(async session => {
    result = await SecuritySession.findOneAndUpdate({ _id: req.params.id, user: req.user._id, revokedAt: null }, { revokedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000) }, { new: true, session });
    if (!result) throw ApiError.notFound('Active session not found');
    await SecurityEvent.create([{ user: req.user._id, type: 'session_revoked', device: result.device, expiresAt: new Date(Date.now() + 30 * 86400000) }], { session });
  });
  return ok(res, { revoked: true, current: String(result._id) === String(req.securitySessionId) });
}));
export default router;

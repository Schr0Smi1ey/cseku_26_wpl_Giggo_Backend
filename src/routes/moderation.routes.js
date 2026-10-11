import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { Job } from '../models/Job.js';
import { Review } from '../models/Review.js';
import { Contract } from '../models/Contract.js';
import { Dispute, UserReport, AuditLog } from '../models/Moderation.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();
const sid = (v) => String(v?._id || v);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const reason = z.string().trim().min(10).max(2000);
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) });
const links = z.array(z.string().url().max(500).refine((v) => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; }, 'Use an HTTPS link')).max(5).default([]);
router.use((req, _res, next) => /^\/(disputes|reports)(\/|$)/.test(req.path) ? next() : next('router'));
router.use(requireAuth);
router.use(rateLimit({ windowMs: 3600000, limit: 100, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => sid(req.user) }));
router.param('id', (req, _res, next, value) => { const r = oid.safeParse(value); next(r.success ? undefined : r.error); });
async function list(Model, filter, page) { const [items, total] = await Promise.all([Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), Model.countDocuments(filter)]); return { items, total, page, pages: Math.ceil(total / 20) }; }
async function disputeAccess(user, id) { const d = await Dispute.findById(id); if (!d || (!user.hasRole('admin') && ![d.client, d.freelancer].some((p) => sid(p) === sid(user)))) throw ApiError.notFound('Dispute not found'); return d; }
const notify = (recipient, d, title, actor) => notificationService.publish({ recipient, actor, eventKey: `dispute:${d._id}:${d.revision}`, type: 'dispute_updated', category: 'disputes', title, actionUrl: `/dashboard/disputes/${d._id}`, entityType: 'dispute', entityId: d._id }).catch(() => null);

router.get('/disputes', asyncHandler(async (req, res) => ok(res, await list(Dispute, req.user.hasRole('admin') ? {} : { $or: [{ client: req.user._id }, { freelancer: req.user._id }] }, pagination.parse(req.query).page))));
router.post('/disputes', validate(z.object({ contract: oid, reason, links }).strict()), asyncHandler(async (req, res) => {
  const c = await Contract.findById(req.body.contract);
  if (!c || ![c.client, c.freelancer].some((p) => sid(p) === sid(req.user))) throw ApiError.notFound('Contract not found');
  if (['completed', 'cancelled'].includes(c.status) && Date.now() - new Date(c.completedAt || c.cancelledAt).getTime() > 30 * 86400000) throw ApiError.badRequest('Disputes must be opened within 30 days of the contract ending');
  await Dispute.init();
  let d;
  try { d = await Dispute.create({ contract: c._id, client: c.client, freelancer: c.freelancer, openedBy: req.user._id, reason: req.body.reason, entries: [{ actor: req.user._id, text: req.body.reason, links: req.body.links }], history: [{ actor: req.user._id, status: 'open', reason: req.body.reason }] }); } catch (e) { if (e.code === 11000) throw ApiError.conflict('This contract already has a dispute'); throw e; }
  await notify(sid(c.client) === sid(req.user) ? c.freelancer : c.client, d, 'A contract dispute was opened', req.user._id);
  return ok(res, { dispute: d }, 'Dispute opened', 201);
}));
router.get('/disputes/:id', asyncHandler(async (req, res) => { const d = await disputeAccess(req.user, req.params.id); await d.populate('client freelancer entries.actor history.actor', 'name avatar'); return ok(res, { dispute: d }); }));
router.post('/disputes/:id/evidence', validate(z.object({ revision: z.number().int().min(1), text: reason, links }).strict()), asyncHandler(async (req, res) => {
  const d = await disputeAccess(req.user, req.params.id);
  if (d.status === 'resolved' || d.entries.length >= 100) throw ApiError.conflict('This dispute is closed or its response limit was reached');
  const updated = await Dispute.findOneAndUpdate({ _id: d._id, revision: req.body.revision, status: mongoose.trusted({ $ne: 'resolved' }) }, { $inc: { revision: 1 }, $push: { entries: { actor: req.user._id, text: req.body.text, links: req.body.links } } }, { new: true });
  if (!updated) throw ApiError.conflict('The dispute changed; refresh and retry');
  await Promise.all([notify(d.client, updated, 'New dispute evidence', req.user._id), notify(d.freelancer, updated, 'New dispute evidence', req.user._id)]);
  return ok(res, { dispute: updated });
}));
router.post('/disputes/:id/decision', requireRole('admin'), validate(z.object({ revision: z.number().int().min(1), status: z.enum(['under_review', 'resolved']), reason }).strict()), asyncHandler(async (req, res) => {
  let updated;
  await mongoose.connection.transaction(async (session) => {
    const d = await Dispute.findById(req.params.id).session(session);
    if (!d || d.status === 'resolved' || d.status === req.body.status || d.revision !== req.body.revision || sid(d.client) === sid(req.user) || sid(d.freelancer) === sid(req.user)) throw ApiError.conflict('Dispute changed, closed, or requires an independent administrator');
    const before = d.status;
    d.status = req.body.status; d.revision += 1; d.resolution = req.body.status === 'resolved' ? req.body.reason : '';
    d.history.push({ actor: req.user._id, status: d.status, reason: req.body.reason });
    await d.save({ session });
    await AuditLog.create([{ actor: req.user._id, action: 'dispute_decision', entityType: 'dispute', entity: d._id, reason: req.body.reason, before, after: d.status }], { session });
    updated = d;
  });
  await Promise.all([notify(updated.client, updated, 'Dispute status updated', req.user._id), notify(updated.freelancer, updated, 'Dispute status updated', req.user._id)]);
  return ok(res, { dispute: updated });
}));
router.get('/reports', asyncHandler(async (req, res) => ok(res, await list(UserReport, req.user.hasRole('admin') ? {} : { reporter: req.user._id }, pagination.parse(req.query).page))));
router.post('/reports', validate(z.object({ targetType: z.enum(['user', 'job', 'review']), target: oid, reason }).strict()), asyncHandler(async (req, res) => {
  const model = { user: User, job: Job, review: Review }[req.body.targetType];
  if (!await model.exists({ _id: req.body.target })) throw ApiError.notFound('Report target not found');
  await UserReport.init();
  try { return ok(res, { report: await UserReport.create({ ...req.body, reporter: req.user._id, history: [{ actor: req.user._id, action: 'open', reason: req.body.reason }] }) }, 'Report submitted', 201); }
  catch (e) { if (e.code === 11000) throw ApiError.conflict('You already reported this item'); throw e; }
}));
router.post('/reports/:id/decision', requireRole('admin'), validate(z.object({ revision: z.number().int().min(1), action: z.enum(['dismiss', 'hide', 'restore']), reason }).strict()), asyncHandler(async (req, res) => {
  let updated;
  await mongoose.connection.transaction(async (session) => {
    const report = await UserReport.findById(req.params.id).session(session);
    if (!report || report.revision !== req.body.revision || sid(report.reporter) === sid(req.user)) throw ApiError.conflict('Report changed or requires an independent administrator');
    const allowed = req.body.action === 'restore' ? ['actioned', 'dismissed', 'appealed'] : ['open', 'appealed'];
    if (!allowed.includes(report.status) || report.history.length >= 100) throw ApiError.conflict('This decision is unavailable in the current report state');
    if (report.targetType === 'review') {
      const review = await Review.findById(report.target).session(session);
      if (review && [review.author, review.subject].some((p) => sid(p) === sid(req.user))) throw ApiError.forbidden('An independent administrator must moderate this review');
    }
    if (req.body.action === 'hide' && report.targetType !== 'review') throw ApiError.badRequest('Use user management or job management for this target');
    if (req.body.action === 'hide') await Review.updateOne({ _id: report.target }, { hiddenAt: new Date() }, { session });
    if (req.body.action === 'restore' && report.targetType === 'review') await Review.updateOne({ _id: report.target }, { hiddenAt: null }, { session });
    const before = report.status;
    report.status = req.body.action === 'dismiss' ? 'dismissed' : req.body.action === 'hide' ? 'actioned' : 'reversed';
    report.revision += 1; report.history.push({ actor: req.user._id, action: req.body.action, reason: req.body.reason });
    await report.save({ session });
    await AuditLog.create([{ actor: req.user._id, action: `report_${req.body.action}`, entityType: 'report', entity: report._id, reason: req.body.reason, before, after: report.status }], { session });
    updated = report;
  });
  return ok(res, { report: updated });
}));
router.post('/reports/:id/appeal', validate(z.object({ reason }).strict()), asyncHandler(async (req, res) => {
  const updated = await UserReport.findOneAndUpdate({ _id: req.params.id, reporter: req.user._id, status: mongoose.trusted({ $in: ['dismissed', 'actioned'] }) }, { $set: { status: 'appealed' }, $inc: { revision: 1 }, $push: { history: { actor: req.user._id, action: 'appeal', reason: req.body.reason } } }, { new: true });
  if (!updated) throw ApiError.conflict('This report is unavailable for appeal');
  return ok(res, { report: updated });
}));
export default router;

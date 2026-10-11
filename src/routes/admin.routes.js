import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { Job } from '../models/Job.js';
import { Contract } from '../models/Contract.js';
import { Payment } from '../models/Payment.js';
import { HourlyInvoice } from '../models/HourlyInvoice.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { AuditLog, Dispute, UserReport } from '../models/Moderation.js';
import { Service, ServiceOrder } from '../models/Service.js';
import { Agency } from '../models/Agency.js';
import { SecurityEvent } from '../models/SecuritySession.js';
import { FinanceOperation } from '../models/FinanceOperation.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) });
const sid = (v) => String(v?._id || v);
const lists = { users: [User, 'name email role status createdAt'], jobs: [Job, 'title client status createdAt'], contracts: [Contract, 'title client freelancer status budget createdAt'], payments: [Payment, 'client freelancer amount currency status escrowStatus createdAt'], invoices: [HourlyInvoice, 'client freelancer totalCents currency createdAt'], verification: [VerificationRequest, 'user status type createdAt'], disputes: [Dispute, 'contract status openedBy createdAt'], reports: [UserReport, 'target targetType status reason createdAt'], audit: [AuditLog, 'actor action entityType entity reason before after createdAt'] };
Object.assign(lists, { services: [Service, 'title owner status createdAt'], orders: [ServiceOrder, 'title buyer seller status package createdAt'], agencies: [Agency, 'name owner visibility createdAt'], security: [SecurityEvent, 'user type device at'], finance: [FinanceOperation, 'actor user kind amountCents currency status reason createdAt'] });
router.get('/overview', asyncHandler(async (_req, res) => {
  const counts = await Promise.all(Object.entries(lists).filter(([name]) => name !== 'audit').map(async ([name, [model]]) => [name, await model.countDocuments({})]));
  return ok(res, { counts: Object.fromEntries(counts), database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable', recentActivity: await AuditLog.find({}).sort({ createdAt: -1 }).limit(10).populate('actor', 'name').lean() });
}));
router.get('/:resource', asyncHandler(async (req, res) => {
  const entry = lists[req.params.resource];
  if (!entry) throw ApiError.notFound();
  const { page } = pageSchema.parse(req.query);
  const [model, fields] = entry;
  const [items, total] = await Promise.all([model.find({}).select(fields).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), model.countDocuments({})]);
  return ok(res, { items, total, page, pages: Math.ceil(total / 20) });
}));
router.post('/users/:id/status', validate(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(10).max(1000) }).strict()), asyncHandler(async (req, res) => {
  z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
  let result;
  await mongoose.connection.transaction(async (session) => {
    const target = await User.findById(req.params.id).session(session);
    if (!target) throw ApiError.notFound('User not found');
    if (sid(target) === sid(req.user) || target.hasRole('admin')) throw ApiError.forbidden('Administrator accounts require a separate reviewed process');
    if (!['active', 'suspended'].includes(target.status) || target.status === req.body.status) throw ApiError.conflict('This user cannot make that status transition');
    const before = target.status;
    target.status = req.body.status;
    await target.save({ session });
    await AuditLog.create([{ actor: req.user._id, action: 'user_status', entityType: 'user', entity: target._id, reason: req.body.reason, before, after: target.status }], { session });
    result = { _id: target._id, name: target.name, status: target.status };
  });
  return ok(res, { user: result });
}));
router.post('/jobs/:id/status', validate(z.object({ status: z.enum(['open', 'closed']), reason: z.string().trim().min(10).max(1000) }).strict()), asyncHandler(async (req, res) => {
  z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
  let result;
  await mongoose.connection.transaction(async session => {
    const job = await Job.findById(req.params.id).session(session);
    if (!job) throw ApiError.notFound('Job not found');
    if (sid(job.client) === sid(req.user)) throw ApiError.forbidden('An independent administrator must moderate this job');
    if (!['open', 'closed'].includes(job.status) || job.hiredProposal || job.status === req.body.status) throw ApiError.conflict('This job cannot make that status transition');
    const before = job.status; job.status = req.body.status;
    await job.save({ session });
    await AuditLog.create([{ actor: req.user._id, action: 'job_status', entityType: 'job', entity: job._id, reason: req.body.reason, before, after: job.status }], { session });
    result = job;
  });
  return ok(res, { job: result });
}));
export default router;

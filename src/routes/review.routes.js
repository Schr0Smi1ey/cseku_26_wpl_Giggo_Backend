import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Review } from '../models/Review.js';
import { Contract } from '../models/Contract.js';
import { ServiceOrder } from '../models/Service.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();
const sid = (v) => String(v?._id || v);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const rating = z.number().int().min(1).max(5);
const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) });
const reviewBody = z.object({ contract: oid.optional(), serviceOrder: oid.optional(), rating, categories: z.object({ communication: rating, quality: rating, reliability: rating }).strict(), title: z.string().trim().min(3).max(120), comment: z.string().trim().min(10).max(2000) }).strict().refine(v => Boolean(v.contract) !== Boolean(v.serviceOrder), 'Select exactly one completed engagement');
const validId = (req, _res, next) => { const result = oid.safeParse(req.params.id); return result.success ? next() : next(result.error); };
const writeLimit = rateLimit({ windowMs: 3600000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => sid(req.user) });

router.get('/profiles/:id', validId, asyncHandler(async (req, res) => {
  const { page } = query.parse(req.query);
  const [profile, activeUser] = await Promise.all([
    FreelancerProfile.exists({ user: req.params.id, visibility: 'public' }),
    User.exists({ _id: req.params.id, status: 'active', roles: 'freelancer' }),
  ]);
  if (!profile || !activeUser) throw ApiError.notFound('Public profile not found');
  const filter = { subject: req.params.id, hiddenAt: null };
  const [items, total, summary] = await Promise.all([
    Review.find(filter).select('author rating categories title comment reply createdAt').populate('author', 'name avatar').sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10).lean(),
    Review.countDocuments(filter),
    Review.aggregate([{ $match: { subject: new mongoose.Types.ObjectId(req.params.id), hiddenAt: null } }, { $group: { _id: null, rating: { $avg: '$rating' }, communication: { $avg: '$categories.communication' }, quality: { $avg: '$categories.quality' }, reliability: { $avg: '$categories.reliability' }, count: { $sum: 1 } } }]),
  ]);
  return ok(res, { items, page, pages: Math.ceil(total / 10), total, reputation: { rating: summary[0]?.rating || 0, count: summary[0]?.count || 0, categories: Object.fromEntries(['communication', 'quality', 'reliability'].map(name => [name, summary[0]?.[name] || 0])) } });
}));
router.use(requireAuth);
router.get('/orders/:id', validId, asyncHandler(async (req, res) => {
  const order = await ServiceOrder.findById(req.params.id);
  if (!order || ![order.buyer, order.seller].some(p => sid(p) === sid(req.user))) throw ApiError.notFound('Order not found');
  const [items, existing] = await Promise.all([Review.find({ serviceOrder: order._id, hiddenAt: null }).populate('author subject', 'name avatar').lean(), Review.exists({ serviceOrder: order._id, author: req.user._id })]);
  return ok(res, { items, eligible: order.status === 'completed' && !existing });
}));
router.get('/contracts/:id', validId, asyncHandler(async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract || ![contract.client, contract.freelancer].some((p) => sid(p) === sid(req.user))) throw ApiError.notFound('Contract not found');
  const items = await Review.find({ contract: contract._id, hiddenAt: null }).populate('author subject', 'name avatar').lean();
  const existing = await Review.exists({ contract: contract._id, author: req.user._id });
  return ok(res, { items, eligible: contract.status === 'completed' && !existing });
}));
router.post('/', writeLimit, validate(reviewBody), asyncHandler(async (req, res) => {
  const isOrder = Boolean(req.body.serviceOrder);
  const contract = isOrder ? await ServiceOrder.findById(req.body.serviceOrder) : await Contract.findById(req.body.contract);
  const buyer = isOrder ? contract?.buyer : contract?.client, seller = isOrder ? contract?.seller : contract?.freelancer;
  if (!contract || ![buyer, seller].some((p) => sid(p) === sid(req.user))) throw ApiError.notFound('Engagement not found');
  if (contract.status !== 'completed') throw ApiError.badRequest('Only completed engagements can be reviewed');
  const subject = sid(buyer) === sid(req.user) ? seller : buyer;
  await Review.init();
  let review;
  try { review = await Review.create({ ...req.body, author: req.user._id, subject }); }
  catch (error) { if (error.code === 11000) throw ApiError.conflict('You already reviewed this contract'); throw error; }
  await notificationService.publish({ recipient: subject, actor: req.user._id, eventKey: `review:${review._id}`, type: 'review_created', title: 'New engagement review', body: req.body.title, actionUrl: `/dashboard/${isOrder ? 'service-orders' : 'contracts'}/${contract._id}`, entityType: 'review', entityId: review._id }).catch(() => null);
  return ok(res, { review }, 'Review published', 201);
}));
router.post('/:id/reply', validId, writeLimit, validate(z.object({ text: z.string().trim().min(3).max(1000) }).strict()), asyncHandler(async (req, res) => {
  const review = await Review.findOneAndUpdate({ _id: req.params.id, subject: req.user._id, hiddenAt: null, 'reply.at': null }, { $set: { reply: { text: req.body.text, at: new Date() } } }, { new: true, runValidators: true });
  if (!review) throw ApiError.conflict('Review unavailable or already replied to');
  return ok(res, { review });
}));
export default router;

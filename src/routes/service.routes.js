import { Router } from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Service, ServiceOrder } from '../models/Service.js';
import { User } from '../models/User.js';
import { VirtualCard } from '../models/VirtualCard.js';
import { WalletLedgerEntry } from '../models/WalletLedgerEntry.js';
import { config } from '../config/index.js';
import { requireAuth, requireRole, optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { virtualCardService } from '../services/virtualCard.service.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();
const sid = (v) => String(v?._id || v);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const https = z.string().url().max(500).refine((s) => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; });
const packageBody = z.object({ tier: z.enum(['basic', 'standard', 'premium']), scope: z.string().trim().min(10).max(2000), amountCents: z.number().int().min(100).max(1000000000), currency: z.literal('BDT').default('BDT'), deliveryDays: z.number().int().min(1).max(365), revisions: z.number().int().min(0).max(20).default(1) }).strict();
const serviceBody = z.object({ title: z.string().trim().min(5).max(150), description: z.string().trim().min(30).max(5000), category: z.string().trim().min(2).max(80), skills: z.array(z.string().trim().min(1).max(50)).max(20).default([]), media: z.array(https).max(5).default([]), packages: z.array(packageBody).min(1).max(3).refine((p) => new Set(p.map((v) => v.tier)).size === p.length), available: z.boolean().default(true), status: z.enum(['draft', 'published', 'archived']).default('draft') }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), q: z.string().trim().max(100).default(''), category: z.string().trim().max(80).optional() });
const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
router.param('id', (req, _res, next, value) => { const r = oid.safeParse(value); next(r.success ? undefined : r.error); });
async function pageOf(Model, filter, page) { const [items, total] = await Promise.all([Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate(Model === Service ? 'owner' : 'buyer seller', 'name avatar').lean(), Model.countDocuments(filter)]); return { items, total, page, pages: Math.ceil(total / 20) }; }

router.get('/', asyncHandler(async (req, res) => {
  const { page, q, category } = pagination.parse(req.query);
  const filter = { status: 'published', available: true };
  if (q) filter.title = { $regex: escape(q), $options: 'i' };
  if (category) filter.category = category;
  const rows = await Service.aggregate([{ $match: filter }, { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'person' } }, { $unwind: '$person' }, { $match: { 'person.status': 'active', 'person.roles': 'freelancer' } }, { $sort: { createdAt: -1, _id: -1 } }, { $facet: { items: [{ $skip: (page - 1) * 20 }, { $limit: 20 }, { $set: { owner: { _id: '$person._id', name: '$person.name', avatar: '$person.avatar' } } }, { $project: { person: 0 } }], count: [{ $count: 'total' }] } }]);
  const total = rows[0]?.count[0]?.total || 0;
  return ok(res, { items: rows[0]?.items || [], total, page, pages: Math.ceil(total / 20) });
}));
router.get('/mine', requireAuth, requireRole('freelancer'), asyncHandler(async (req, res) => ok(res, await pageOf(Service, { owner: req.user._id }, pagination.parse(req.query).page))));
router.get('/orders', requireAuth, asyncHandler(async (req, res) => ok(res, await pageOf(ServiceOrder, { $or: [{ buyer: req.user._id }, { seller: req.user._id }] }, pagination.parse(req.query).page))));
router.get('/orders/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await ServiceOrder.findById(req.params.id).populate('buyer seller', 'name avatar');
  if (!order || ![order.buyer, order.seller].some((v) => sid(v) === sid(req.user))) throw ApiError.notFound('Order not found');
  return ok(res, { order });
}));
router.post('/', requireAuth, requireRole('freelancer'), validate(serviceBody), asyncHandler(async (req, res) => ok(res, { service: await Service.create({ ...req.body, owner: req.user._id }) }, 'Service saved', 201)));
router.put('/:id', requireAuth, requireRole('freelancer'), validate(serviceBody.extend({ revision: z.number().int().min(1) })), asyncHandler(async (req, res) => {
  const { revision, ...body } = req.body;
  const service = await Service.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, revision }, { $set: body, $inc: { revision: 1 } }, { new: true, runValidators: true });
  if (!service) throw ApiError.conflict('Service unavailable or changed; refresh and retry');
  return ok(res, { service });
}));
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id).populate('owner', 'name avatar status');
  if (!service || (sid(service.owner) !== sid(req.user) && (service.status !== 'published' || service.owner?.status !== 'active'))) throw ApiError.notFound('Service not found');
  return ok(res, { service });
}));
router.post('/:id/orders', requireAuth, requireRole('client'), validate(z.object({ tier: z.enum(['basic', 'standard', 'premium']), requirements: z.string().trim().min(20).max(5000), idempotencyKey: z.string().min(8).max(120) }).strict()), asyncHandler(async (req, res) => {
  await ServiceOrder.init();
  let order;
  await mongoose.connection.transaction(async (session) => {
    order = await ServiceOrder.findOne({ buyer: req.user._id, idempotencyKey: req.body.idempotencyKey }).session(session);
    if (order) { if (sid(order.service) !== req.params.id || order.package.tier !== req.body.tier || order.requirements !== req.body.requirements) throw ApiError.conflict('Order request key already used'); return; }
    const service = await Service.findOne({ _id: req.params.id, status: 'published', available: true }).session(session);
    if (!service || !await User.exists({ _id: service.owner, status: 'active' }).session(session)) throw ApiError.notFound('Service unavailable');
    if (sid(service.owner) === sid(req.user)) throw ApiError.badRequest('You cannot order your own service');
    const selected = service.packages.find((p) => p.tier === req.body.tier);
    if (!selected) throw ApiError.badRequest('Package unavailable');
    [order] = await ServiceOrder.create([{ service: service._id, buyer: req.user._id, seller: service.owner, title: service.title, package: selected.toObject(), requirements: req.body.requirements, remainingRevisions: selected.revisions, idempotencyKey: req.body.idempotencyKey, history: [{ actor: req.user._id, action: 'pending', note: 'Order placed' }] }], { session });
    // Claim the listing revision so concurrent package edits cannot change the
    // snapshot halfway through ordering.
    await Service.updateOne({ _id: service._id, revision: service.revision }, { $inc: { revision: 1 } }, { session });
  });
  return ok(res, { order }, 'Order created', 201);
}));
router.post('/orders/:id/actions', requireAuth, validate(z.object({ revision: z.number().int().min(1), action: z.enum(['fund', 'accept', 'deliver', 'request_revision', 'complete', 'cancel']), note: z.string().trim().min(10).max(2000), links: z.array(https).max(5).default([]) }).strict()), asyncHandler(async (req, res) => {
  if (['fund', 'complete'].includes(req.body.action)) await virtualCardService.ensureForUser(req.user);
  let result;
  await mongoose.connection.transaction(async (session) => {
    const order = await ServiceOrder.findById(req.params.id).session(session);
    if (!order || ![order.buyer, order.seller].some((p) => sid(p) === sid(req.user))) throw ApiError.notFound('Order not found');
    if (order.revision !== req.body.revision || ['completed', 'cancelled'].includes(order.status)) throw ApiError.conflict('Order changed or is closed');
    const buyer = sid(order.buyer) === sid(req.user), action = req.body.action;
    const allowed = { fund: buyer && order.status === 'pending', accept: !buyer && order.status === 'funded', deliver: !buyer && ['active', 'revision_requested'].includes(order.status) && order.deliveries.length < 25, request_revision: buyer && order.status === 'delivered' && order.remainingRevisions > 0, complete: buyer && order.status === 'delivered', cancel: (buyer && ['pending', 'funded'].includes(order.status)) || (!buyer && ['pending', 'funded', 'active', 'revision_requested'].includes(order.status)) };
    if (!allowed[action]) throw ApiError.forbidden('This action is unavailable for your role or the order state');
    const value = order.package.amountCents / 100;
    const ledger = async (card, direction, amount, type, text) => {
      card.balance = Math.round((card.balance + (direction === 'credit' ? amount : -amount)) * 100) / 100;
      if (card.balance < 0) throw ApiError.badRequest('Insufficient simulated wallet funds');
      await card.save({ session });
      await WalletLedgerEntry.create([{ entryNumber: `LED-${crypto.randomUUID()}`, user: card.user, card: card._id, type, direction, amount, currency: card.currency, referenceType: 'SERVICE_ORDER', referenceId: order._id, balanceAfter: card.balance, description: text }], { session });
    };
    if (action === 'fund' || action === 'complete' || (action === 'cancel' && order.status !== 'pending')) {
      const payer = await VirtualCard.findOne({ user: order.buyer }).session(session);
      if (!payer || payer.currency !== order.package.currency || ['suspended', 'blocked', 'cancelled'].includes(payer.status)) throw ApiError.badRequest('A usable simulated wallet in the order currency is required');
      if (action === 'fund') { payer.heldBalance = Math.round((payer.heldBalance + value) * 100) / 100; await ledger(payer, 'debit', value, 'client_payment', 'Simulated service order escrow'); }
      else {
        if (payer.heldBalance < value) throw ApiError.conflict('Escrow balance requires reconciliation');
        payer.heldBalance = Math.round((payer.heldBalance - value) * 100) / 100;
        if (action === 'cancel') await ledger(payer, 'credit', value, 'refund', 'Simulated service order cancellation refund');
        else {
          const seller = await User.findById(order.seller).session(session);
          if (!seller || seller.status !== 'active') throw ApiError.badRequest('Seller account requires review before release');
          const payee = await VirtualCard.findOne({ user: order.seller }).session(session);
          if (!payee || payee.currency !== order.package.currency || ['suspended', 'blocked', 'cancelled'].includes(payee.status)) throw ApiError.badRequest('Seller must have a usable wallet in the order currency');
          order.feeCents = Math.min(order.package.amountCents, Math.round(order.package.amountCents * config.payment.feePercentage / 100) + Math.round(config.payment.fixedFee * 100));
          await payer.save({ session });
          await ledger(payee, 'credit', (order.package.amountCents - order.feeCents) / 100, 'developer_earning', 'Simulated service order earning after fee');
        }
      }
    }
    const states = { fund: 'funded', accept: 'active', deliver: 'delivered', request_revision: 'revision_requested', complete: 'completed', cancel: 'cancelled' };
    order.status = states[action]; order.revision += 1;
    if (action === 'accept') order.deliveryDueAt = new Date(Date.now() + order.package.deliveryDays * 86400000);
    if (action === 'deliver') order.deliveries.push({ text: req.body.note, links: req.body.links });
    if (action === 'request_revision') order.remainingRevisions -= 1;
    order.history.push({ actor: req.user._id, action, note: req.body.note });
    await order.save({ session }); result = order;
  });
  await notificationService.publish({ recipient: sid(result.buyer) === sid(req.user) ? result.seller : result.buyer, actor: req.user._id, eventKey: `service-order:${result._id}:${result.revision}`, type: 'service_order_updated', title: 'Service order updated', body: result.title, actionUrl: `/dashboard/service-orders/${result._id}`, entityType: 'service_order', entityId: result._id }).catch(() => null);
  return ok(res, { order: result });
}));
export default router;

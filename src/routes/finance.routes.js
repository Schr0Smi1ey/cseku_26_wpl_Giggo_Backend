import { Router } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { FinanceOperation } from '../models/FinanceOperation.js';
import { VirtualCard } from '../models/VirtualCard.js';
import { WalletLedgerEntry } from '../models/WalletLedgerEntry.js';
import { Payment } from '../models/Payment.js';
import { ServiceOrder } from '../models/Service.js';
import { AuditLog, Dispute } from '../models/Moderation.js';
import { Milestone } from '../models/Milestone.js';
const router = Router(), sid = v => String(v?._id || v);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const common = { idempotencyKey: z.string().min(8).max(120), reason: z.string().trim().min(10).max(1000) };
router.use(requireAuth, rateLimit({ windowMs: 3600000, limit: 100, keyGenerator: req => sid(req.user), standardHeaders: true, legacyHeaders: false }));
async function execute(req, kind) {
  await FinanceOperation.init();
  let operation;
  const run = async session => {
    operation = await FinanceOperation.findOne({ actor: req.user._id, idempotencyKey: req.body.idempotencyKey }).session(session);
    if (operation) {
      if (operation.kind !== kind || operation.reason !== req.body.reason || (kind !== 'refund' && operation.amountCents !== req.body.amountCents) || (req.body.user && sid(operation.user) !== req.body.user) || (req.body.payment && sid(operation.payment) !== req.body.payment) || (kind === 'withdrawal' && operation.outcome !== req.body.outcome)) throw ApiError.conflict('Request key already used for a different operation');
      return;
    }
    let user = req.body.user || req.user._id, amount = req.body.amountCents, payment;
    if (kind === 'refund') {
      payment = await Payment.findById(req.body.payment).session(session);
      if (!payment || payment.status !== 'succeeded' || payment.escrowStatus !== 'funded') throw ApiError.conflict('Only funded unreleased escrow can be refunded');
      if ([payment.client, payment.freelancer].some(u => sid(u) === sid(req.user))) throw ApiError.forbidden('An independent administrator must authorize refunds');
      if (!await Dispute.exists({ contract: payment.contract, status: 'resolved' }).session(session)) throw ApiError.badRequest('A resolved dispute decision is required before an administrative refund');
      user = payment.client; amount = payment.amountMinor;
    }
    if (kind === 'adjustment' && sid(user) === sid(req.user)) throw ApiError.forbidden('Administrators cannot adjust their own wallet');
    const card = await VirtualCard.findOne({ user }).session(session);
    if (!card) throw ApiError.notFound('Wallet not found');
    if (kind === 'withdrawal' && card.status !== 'active') throw ApiError.badRequest('Only active simulated wallets can withdraw');
    if (kind === 'refund' && (card.currency !== payment.currency || Math.round(card.heldBalance * 100) < amount)) throw ApiError.conflict('Escrow currency or balance requires reconciliation');
    const failed = kind === 'withdrawal' && req.body.outcome === 'failed';
    const delta = kind === 'withdrawal' ? -amount : amount;
    if (!failed && Math.round(card.balance * 100) + delta < 0) throw ApiError.badRequest('Insufficient wallet balance');
    [operation] = await FinanceOperation.create([{ actor: req.user._id, user, kind, amountCents: amount, currency: card.currency, status: failed ? 'failed' : 'succeeded', outcome: req.body.outcome, reason: req.body.reason, idempotencyKey: req.body.idempotencyKey, payment: payment?._id }], { session });
    if (failed) return;
    const before = card.balance;
    card.balance = (Math.round(card.balance * 100) + delta) / 100;
    if (kind === 'refund') { card.heldBalance = (Math.round(card.heldBalance * 100) - amount) / 100; payment.status = 'refunded'; payment.escrowStatus = 'refunded'; payment.refundedAt = new Date(); await payment.save({ session }); await Milestone.updateOne({ _id: payment.milestone }, { $set: { paymentState: 'not_ready', status: 'pending' } }, { session }); }
    await card.save({ session });
    await WalletLedgerEntry.create([{ entryNumber: `LED-${randomUUID()}`, user, card: card._id, type: kind, direction: delta >= 0 ? 'credit' : 'debit', amount: Math.abs(delta) / 100, currency: card.currency, referenceType: 'SIMULATED_FINANCE_OPERATION', referenceId: operation._id, balanceAfter: card.balance, description: req.body.reason, metadata: { balanceBefore: before, simulated: true } }], { session });
    if (kind !== 'withdrawal') await AuditLog.create([{ actor: req.user._id, action: `finance_${kind}`, entityType: 'finance_operation', entity: operation._id, reason: req.body.reason, before: String(before), after: String(card.balance) }], { session });
  };
  try { await mongoose.connection.transaction(run); } catch (e) { if (e.code !== 11000) throw e; await mongoose.connection.transaction(run); }
  return operation;
}
router.post('/withdrawals', requireRole('freelancer'), validate(z.object({ ...common, amountCents: z.number().int().min(100).max(100000000), outcome: z.enum(['success', 'failed']).default('success') }).strict()), asyncHandler(async (req, res) => ok(res, { operation: await execute(req, 'withdrawal'), simulated: true })));
router.get('/operations', asyncHandler(async (req, res) => {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const filter = { user: req.user._id };
  const [items, total] = await Promise.all([FinanceOperation.find(filter).select('-idempotencyKey').sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), FinanceOperation.countDocuments(filter)]);
  return ok(res, { items, total, page, pages: Math.ceil(total / 20), simulated: true });
}));
router.post('/adjustments', requireRole('admin'), validate(z.object({ ...common, user: oid, amountCents: z.number().int().min(-1000000).max(1000000).refine(v => v !== 0) }).strict()), asyncHandler(async (req, res) => ok(res, { operation: await execute(req, 'adjustment'), simulated: true })));
router.post('/refunds', requireRole('admin'), validate(z.object({ ...common, payment: oid }).strict()), asyncHandler(async (req, res) => ok(res, { operation: await execute(req, 'refund'), simulated: true })));
router.get('/reconciliation', requireRole('admin'), asyncHandler(async (req, res) => {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const cards = await VirtualCard.find({}).select('user balance heldBalance currency').sort({ _id: 1 }).skip((page - 1) * 20).limit(20).lean();
  const items = await Promise.all(cards.map(async card => {
    const [ledger, payments, orders] = await Promise.all([
      WalletLedgerEntry.aggregate([{ $match: { card: card._id } }, { $group: { _id: null, balanceCents: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, { $round: [{ $multiply: ['$amount', 100] }, 0] }, { $multiply: [-1, { $round: [{ $multiply: ['$amount', 100] }, 0] }] }] } } } }]),
      Payment.aggregate([{ $match: { client: card.user, escrowStatus: 'funded', currency: card.currency } }, { $group: { _id: null, heldCents: { $sum: '$amountMinor' } } }]),
      ServiceOrder.aggregate([{ $match: { buyer: card.user, status: { $in: ['funded', 'active', 'delivered', 'revision_requested'] }, 'package.currency': card.currency } }, { $group: { _id: null, heldCents: { $sum: '$package.amountCents' } } }]),
    ]);
    const expectedBalanceCents = ledger[0]?.balanceCents || 0, expectedHeldCents = (payments[0]?.heldCents || 0) + (orders[0]?.heldCents || 0);
    return { ...card, expectedBalanceCents, expectedHeldCents, balanceDifferenceCents: Math.round(card.balance * 100) - expectedBalanceCents, heldDifferenceCents: Math.round(card.heldBalance * 100) - expectedHeldCents };
  }));
  const total = await VirtualCard.countDocuments({});
  return ok(res, { items, page, pages: Math.ceil(total / 20), total, simulated: true });
}));
export default router;

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { ESCROW_STATUS, PAYMENT_STATUS, SIMULATED_PROVIDER } from '../config/constants.js';
import { getPaymentProvider } from '../integrations/payment/index.js';
import { Contract, CONTRACT_STATUSES } from '../models/Contract.js';
import { Milestone, MILESTONE_STATUSES } from '../models/Milestone.js';
import { Payment } from '../models/Payment.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { Project } from '../models/Project.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from './notification.service.js';
import { emitToUser } from './realtime.service.js';
import { virtualCardService } from './virtualCard.service.js';

const sid = (value) => String(value);
const ref = (prefix = 'GG-TXN') => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
const number = (prefix) => `${prefix}-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}-${crypto.randomBytes(2).toString('hex')}`;
const cents = (value) => Math.round(Number(value || 0) * 100);
const fee = (gross) => Math.max(0, Math.round(cents(gross) * config.payment.feePercentage / 100) + cents(config.payment.fixedFee));
const providers = new Set(Object.values(SIMULATED_PROVIDER));

export function publicPayment(payment) {
  const result = payment.toObject ? payment.toObject() : { ...payment };
  for (const field of ['metadata', 'simulationOutcome', 'providerPaymentId', 'idempotencyKey', 'freelancerAmount', '__v']) delete result[field];
  return result;
}

export function emitPayment(payment, event) {
  const data = { payment: publicPayment(payment) };
  for (const recipient of [payment.client, payment.freelancer]) emitToUser(recipient, event, data);
}

async function accessPayment(user, paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment || ![payment.client, payment.freelancer].some((party) => sid(party) === sid(user._id))) throw ApiError.notFound('Payment not found');
  return payment;
}

// Notifications are best-effort and published after the money movement has committed.
const notify = (recipient, values) => notificationService
  .publish({ recipient, category: 'payments', entityType: 'payment', ...values })
  .catch(() => null);

export const paymentService = {
  async fundMilestone(user, milestoneId, idempotencyKey, provider = SIMULATED_PROVIDER.BKASH, outcome = 'success') {
    const actor = await User.findById(user._id);
    if (!actor?.hasRole('client')) throw ApiError.forbidden('Only clients can fund milestones');
    if (!idempotencyKey || idempotencyKey.length > 180) throw ApiError.badRequest('A valid Idempotency-Key is required');
    if (!providers.has(provider)) throw ApiError.badRequest('Unsupported payment method');
    if (!['success', 'failed'].includes(outcome) || (config.isProduction && outcome !== 'success')) throw ApiError.badRequest('Invalid simulation outcome');
    // Provision the client's own card before escrow debits so card and ledger stay synchronized.
    await virtualCardService.ensureForUser(actor);
    let result;
    try {
      await mongoose.connection.transaction(async (session) => {
        const milestone = await Milestone.findById(milestoneId).session(session);
        if (!milestone) throw ApiError.notFound('Milestone not found');
        const project = await Project.findById(milestone.project).session(session);
        const contract = await Contract.findById(milestone.contract).session(session);
        if (!project || sid(project.client) !== sid(user._id)) throw ApiError.forbidden('Only the project client can fund this milestone');
        if (!contract || sid(contract.client) !== sid(project.client) || sid(contract._id) !== sid(project.contract) || sid(contract.freelancer) !== sid(project.freelancer)) throw ApiError.badRequest('Milestone contract does not match the project');
        const priorAttempt = await PaymentTransaction.findOne({ idempotencyKey }).session(session);
        if (priorAttempt) {
          if (sid(priorAttempt.user) !== sid(user._id) || sid(priorAttempt.milestoneId) !== sid(milestone._id)) throw ApiError.conflict('Idempotency key is already in use');
          result = await Payment.findById(priorAttempt.metadata.payment).session(session);
          return;
        }
        let payment = await Payment.findOne({ milestone: milestone._id }).session(session);
        if (payment && ![PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELLED].includes(payment.status)) {
          result = payment;
          return;
        }
        if (contract.status !== CONTRACT_STATUSES.ACTIVE) throw ApiError.badRequest('Contract is not active');
        if (![MILESTONE_STATUSES.PENDING, MILESTONE_STATUSES.FUNDING_PENDING].includes(milestone.status)) throw ApiError.badRequest('Milestone is not eligible for funding');
        const gross = cents(milestone.amount);
        const fees = fee(milestone.amount);
        if (!Number.isSafeInteger(gross) || gross <= 0 || fees > gross) throw ApiError.badRequest('Invalid milestone amount or fees');
        const intent = await getPaymentProvider().createPaymentIntent({ amount: gross, currency: config.payment.currency, metadata: { milestone: sid(milestone._id) } });
        const values = {
          transactionReference: ref(),
          client: project.client,
          freelancer: contract.freelancer,
          project: project._id,
          contract: contract._id,
          milestone: milestone._id,
          job: contract.job,
          provider,
          paymentMethod: provider,
          providerPaymentId: intent.id,
          amount: gross / 100,
          amountMinor: gross,
          currency: config.payment.currency,
          platformFee: fees / 100,
          freelancerAmount: (gross - fees) / 100,
          status: PAYMENT_STATUS.CHECKOUT_CREATED,
          escrowStatus: ESCROW_STATUS.FUNDING_PENDING,
          idempotencyKey,
          simulationOutcome: outcome,
          processAfter: new Date(Date.now() + 1200),
          failureReason: undefined,
          processingAt: undefined,
          completedAt: undefined,
        };
        if (payment) {
          Object.assign(payment, values);
          await payment.save({ session });
        } else {
          [payment] = await Payment.create([{ ...values, paymentNumber: number('PAY') }], { session });
        }
        await PaymentTransaction.create([{
          transactionNumber: payment.transactionReference,
          transactionReference: payment.transactionReference,
          user: project.client,
          clientId: project.client,
          developerId: contract.freelancer,
          projectId: project._id,
          contractId: contract._id,
          milestoneId: milestone._id,
          amount: payment.amount,
          amountMinor: gross,
          currency: payment.currency,
          paymentMethod: provider,
          provider,
          providerTransactionId: intent.id,
          type: 'client_payment',
          status: 'pending',
          idempotencyKey,
          metadata: { payment: payment._id },
        }], { session });
        milestone.status = MILESTONE_STATUSES.FUNDING_PENDING;
        milestone.paymentState = 'funding_pending';
        await milestone.save({ session });
        result = payment;
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const payment = await Payment.findOne({ milestone: milestoneId, client: user._id });
      if (!payment) throw ApiError.conflict('Payment key is already in use');
      result = payment;
    }
    // The developer's card must exist before earnings can be credited on release.
    if (result) await virtualCardService.ensureForUser({ _id: result.freelancer });
    return result;
  },

  async simulateFundMilestone(user, milestoneId, outcome, key, provider) {
    return this.fundMilestone(user, milestoneId, key, provider, outcome);
  },

  // Advances queued simulated payments: checkout -> processing -> succeeded/failed.
  async processPending() {
    const pending = await Payment.find({
      status: mongoose.trusted({ $in: [PAYMENT_STATUS.CHECKOUT_CREATED, PAYMENT_STATUS.PROCESSING] }),
      processAfter: mongoose.trusted({ $lte: new Date() }),
    }).select('_id').limit(50);
    for (const row of pending) {
      let updated = null;
      let notices = [];
      await mongoose.connection.transaction(async (session) => {
        updated = null;
        notices = [];
        const p = await Payment.findById(row._id).select('+simulationOutcome').session(session);
        if (!p || p.processAfter > new Date() || ![PAYMENT_STATUS.CHECKOUT_CREATED, PAYMENT_STATUS.PROCESSING].includes(p.status)) return;
        if (p.status === PAYMENT_STATUS.CHECKOUT_CREATED) {
          p.status = PAYMENT_STATUS.PROCESSING;
          p.processingAt = new Date();
          p.processAfter = new Date(Date.now() + 1800);
          await PaymentTransaction.updateOne({ idempotencyKey: p.idempotencyKey }, { $set: { status: 'processing' } }, { session });
        } else {
          const failed = p.simulationOutcome === 'failed';
          p.status = failed ? PAYMENT_STATUS.FAILED : PAYMENT_STATUS.SUCCEEDED;
          p.escrowStatus = failed ? ESCROW_STATUS.NOT_FUNDED : ESCROW_STATUS.FUNDED;
          p.completedAt = new Date();
          p.failureReason = failed ? 'Payment provider simulation failed. No funds were collected.' : undefined;
          if (!failed) p.paidAt = p.completedAt;
          await PaymentTransaction.updateOne({ idempotencyKey: p.idempotencyKey }, { $set: { status: failed ? 'failed' : 'success', completedAt: p.completedAt } }, { session });
          await Milestone.updateOne({ _id: p.milestone }, { $set: { status: failed ? MILESTONE_STATUSES.PENDING : MILESTONE_STATUSES.FUNDED, paymentState: failed ? 'not_ready' : 'funded' } }, { session });
          if (!failed) {
            await Transaction.create([{ transactionNumber: number('TXN'), user: p.client, payment: p._id, project: p.project, contract: p.contract, milestone: p.milestone, type: 'escrow_funding', direction: 'debit', amount: p.amount, amountMinor: p.amountMinor, currency: p.currency, description: 'Milestone funds held in escrow' }], { session });
            await virtualCardService.debitForEscrow(p.client, p.amount, p._id, { project: p.project, contract: p.contract, milestone: p.milestone }, session);
          }
          notices = failed
            ? [[p.client, { type: 'payment_failed', title: 'Payment failed', body: p.failureReason }]]
            : [p.client, p.freelancer].map((recipient) => [recipient, { type: 'escrow_funded', title: 'Milestone escrow funded', body: `${p.amount} ${p.currency} is held in escrow until approved and released.` }]);
        }
        await p.save({ session });
        updated = p;
      });
      if (!updated) continue;
      for (const [recipient, values] of notices) {
        await notify(recipient, { ...values, eventKey: `payment:${updated._id}:${values.type}`, entityId: updated._id, actionUrl: `/dashboard/payments/${updated._id}` });
      }
      const event = updated.status === PAYMENT_STATUS.SUCCEEDED ? 'payment:success' : updated.status === PAYMENT_STATUS.FAILED ? 'payment:failed' : 'payment:processing';
      emitPayment(updated, event);
      if (updated.status === PAYMENT_STATUS.SUCCEEDED) {
        emitPayment(updated, 'escrow:funded');
        emitPayment(updated, 'milestone:funded');
        emitToUser(updated.client, 'transaction:new', { payment: publicPayment(updated) });
        emitToUser(updated.client, 'card:updated', { payment: publicPayment(updated) });
        emitToUser(updated.client, 'wallet:updated', {});
      }
    }
  },

  async list(user) {
    return Payment.find({ $or: [{ client: user._id }, { freelancer: user._id }] })
      .select('-metadata -providerPaymentId -idempotencyKey -freelancerAmount')
      .populate('contract milestone', 'title')
      .populate('freelancer', 'name')
      .sort({ createdAt: -1 });
  },

  async getOne(user, paymentId) {
    const payment = await accessPayment(user, paymentId);
    await payment.populate('contract milestone', 'title');
    await payment.populate('freelancer', 'name');
    const result = publicPayment(payment);
    result.attempts = await PaymentTransaction.find({ 'metadata.payment': payment._id, type: 'client_payment' })
      .select('transactionReference amount currency provider status createdAt completedAt')
      .sort({ createdAt: -1 });
    return result;
  },

  async release(user, milestoneId) {
    let result;
    let released;
    await mongoose.connection.transaction(async (session) => {
      const milestone = await Milestone.findById(milestoneId).session(session);
      if (!milestone) throw ApiError.notFound('Milestone not found');
      const project = await Project.findById(milestone.project).session(session);
      const actor = await User.findById(user._id).session(session);
      if (!actor?.hasRole('client') || sid(project.client) !== sid(user._id)) throw ApiError.forbidden('Only the client can release funds');
      const payment = await Payment.findOne({ milestone: milestone._id }).session(session);
      if (!payment) throw ApiError.badRequest('Milestone has not been funded');
      const prior = await Transaction.findOne({ payment: payment._id, type: 'escrow_release' }).session(session);
      if (prior) {
        result = prior;
        return;
      }
      if (payment.status !== PAYMENT_STATUS.SUCCEEDED || payment.escrowStatus !== ESCROW_STATUS.FUNDED || milestone.status !== MILESTONE_STATUSES.APPROVED) {
        throw ApiError.badRequest('Funded milestone must be approved before release');
      }
      const wallet = await Wallet.findOneAndUpdate({ user: payment.freelancer }, { $setOnInsert: { user: payment.freelancer, currency: payment.currency } }, { session, upsert: true, new: true });
      const before = wallet.pendingBalance;
      wallet.pendingBalance = (cents(before) + cents(payment.freelancerAmount)) / 100;
      wallet.totalEarned = (cents(wallet.totalEarned) + cents(payment.freelancerAmount)) / 100;
      await wallet.save({ session });
      const meta = { project: payment.project, contract: payment.contract, milestone: payment.milestone };
      await virtualCardService.creditEarning(payment.freelancer, payment.freelancerAmount, payment._id, meta, session);
      await virtualCardService.releaseEscrow(payment.client, payment.amount, payment._id, meta, session);
      [result] = await Transaction.create([{ transactionNumber: number('TXN'), user: payment.freelancer, payment: payment._id, project: payment.project, contract: payment.contract, milestone: payment.milestone, type: 'escrow_release', direction: 'credit', amount: payment.freelancerAmount, amountMinor: cents(payment.freelancerAmount), currency: payment.currency, balanceBefore: before, balanceAfter: wallet.pendingBalance, description: 'Approved milestone earnings credited to virtual card' }], { session });
      payment.escrowStatus = ESCROW_STATUS.RELEASED;
      await payment.save({ session });
      milestone.paymentState = 'paid';
      milestone.status = MILESTONE_STATUSES.PAID;
      await milestone.save({ session });
      released = payment;
    });
    if (released) {
      await notify(released.freelancer, { type: 'escrow_released', eventKey: `payment:${released._id}:released`, title: 'Earnings credited', body: `${released.freelancerAmount} ${released.currency} credited to your virtual card.`, entityId: released._id, actionUrl: '/dashboard/card' });
      emitPayment(released, 'escrow:released');
      emitToUser(released.freelancer, 'developer:earning', { payment: publicPayment(released) });
      for (const party of [released.freelancer, released.client]) {
        emitToUser(party, 'wallet:updated', {});
        emitToUser(party, 'card:updated', { payment: publicPayment(released) });
      }
      emitToUser(released.client, 'transaction:new', { payment: publicPayment(released) });
    }
    return result;
  },

  async getWallet(user) {
    return Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id, currency: config.payment.currency } }, { upsert: true, new: true });
  },

  async transactions(user) {
    return Transaction.find({ user: user._id }).sort({ createdAt: -1 });
  },
};

export function startPaymentWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await paymentService.processPending();
    } catch (error) {
      console.error('Payment worker could not settle pending payments; will retry', { code: error.code });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

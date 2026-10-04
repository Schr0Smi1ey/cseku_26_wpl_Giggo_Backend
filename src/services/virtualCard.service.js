import crypto from 'node:crypto';
import { VirtualCard } from '../models/VirtualCard.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { WalletLedgerEntry } from '../models/WalletLedgerEntry.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/index.js';
import { LEDGER_ENTRY_TYPE, FINANCE, SIMULATED_PAYMENT_STATUS, SIMULATED_PROVIDER, VIRTUAL_CARD_STATUS } from '../config/constants.js';

const id = (value) => String(value);
const ref = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const providers = new Set(Object.values(SIMULATED_PROVIDER));

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function cardView(card) {
  return card?.toJSON ? card.toJSON() : card;
}

export const virtualCardService = {
  async ensureForUser(user) {
    if (!config.virtualCard.enabled) return null;
    if (!user?._id) return null;
    const existing = await VirtualCard.findOne({ user: user._id });
    if (existing) return existing;
    const seed = crypto.randomBytes(8).toString('hex').toUpperCase();
    const lastFour = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const internalNumber = `GG${seed}${lastFour}`;
    try {
      return await VirtualCard.create({
        user: user._id,
        maskedCardNumber: `4928 **** **** ${lastFour}`,
        cardNumberHash: hash(internalNumber),
        expiryMonth: new Date().getMonth() + 1,
        expiryYear: new Date().getFullYear() + 5,
        currency: config.virtualCard.currency || FINANCE.CURRENCY,
        activationMinimum: config.virtualCard.activationMinimum,
      });
    } catch (error) {
      if (error?.code === 11000) return VirtualCard.findOne({ user: user._id });
      throw error;
    }
  },

  async getMine(user) {
    const card = await this.ensureForUser(user);
    return card?.populate('user', 'name avatar');
  },

  async activate(user) {
    const card = await this.ensureForUser(user);
    if (!card) throw ApiError.forbidden('Virtual card is unavailable');
    if (card.balance < card.activationMinimum) throw ApiError.badRequest('Activation minimum has not been reached');
    if (card.status === VIRTUAL_CARD_STATUS.SUSPENDED) throw ApiError.badRequest('Unfreeze the card before activating it');
    card.status = VIRTUAL_CARD_STATUS.ACTIVE; card.activatedAt = card.activatedAt || new Date(); await card.save(); return card;
  },

  async eligibility(user) {
    // With the card system switched off there is nothing to gate on.
    if (!config.virtualCard.enabled) return { card: null, canApplyForJobs: true, canAcceptOffers: true, canReceiveWork: true };
    const card = await this.ensureForUser(user);
    if (!card) return { card: null, canApplyForJobs: false, canAcceptOffers: false, canReceiveWork: false, reason: 'FREELANCER_CARD_REQUIRED' };
    const active = card.status === VIRTUAL_CARD_STATUS.ACTIVE;
    const amountRequired = Math.max(0, card.activationMinimum - card.balance);
    return {
      card: cardView(card),
      canApplyForJobs: active,
      canAcceptOffers: active,
      canReceiveWork: active,
      ...(active ? {} : { reason: card.status === VIRTUAL_CARD_STATUS.SUSPENDED ? 'CARD_SUSPENDED' : 'CARD_ACTIVATION_REQUIRED', amountRequired }),
    };
  },

  async reload(user, { amount, provider, outcome = 'success' }, idempotencyKey) {
    if (!idempotencyKey) throw ApiError.badRequest('Idempotency-Key is required');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw ApiError.badRequest('Reload amount must be greater than zero');
    if (!providers.has(provider)) throw ApiError.badRequest('Unsupported simulated payment provider');
    const card = await this.ensureForUser(user);
    if (!card) throw ApiError.forbidden('Only freelancers can reload a virtual card');
    if ([VIRTUAL_CARD_STATUS.SUSPENDED, VIRTUAL_CARD_STATUS.BLOCKED, VIRTUAL_CARD_STATUS.CANCELLED].includes(card.status)) throw ApiError.badRequest('Your card is not available for reload');
    const prior = await PaymentTransaction.findOne({ idempotencyKey });
    if (prior) return { payment: prior, card };
    const payment = await PaymentTransaction.create({ transactionNumber: ref('PAY'), user: user._id, card: card._id, amount: Math.round(amount * 100) / 100, currency: card.currency, provider, providerTransactionId: ref('SIM'), type: 'card_reload', status: outcome === 'failed' ? SIMULATED_PAYMENT_STATUS.FAILED : SIMULATED_PAYMENT_STATUS.SUCCESS, idempotencyKey, metadata: { simulated: true }, completedAt: outcome === 'failed' ? undefined : new Date() });
    if (payment.status === SIMULATED_PAYMENT_STATUS.FAILED) return { payment, card };
    const before = card.balance;
    card.balance += payment.amount;
    if (card.status === VIRTUAL_CARD_STATUS.INACTIVE && card.balance >= card.activationMinimum) { card.status = VIRTUAL_CARD_STATUS.ACTIVE; card.activatedAt = card.activatedAt || new Date(); }
    await card.save();
    await WalletLedgerEntry.create({ entryNumber: ref('LED'), user: user._id, card: card._id, type: LEDGER_ENTRY_TYPE.CARD_RELOAD, direction: 'credit', amount: payment.amount, currency: card.currency, referenceType: 'PAYMENT', referenceId: payment._id, balanceAfter: card.balance, description: `${provider.replace('_SIMULATED', '')} simulated card reload` });
    return { payment, card };
  },

  async transactions(user) {
    const card = await this.ensureForUser(user);
    if (!card) return [];
    return WalletLedgerEntry.find({ user: user._id, card: card._id }).sort({ createdAt: -1 }).limit(100);
  },

  async wallet(user) {
    const card = await this.ensureForUser(user);
    return card ? { balance: card.balance, heldBalance: card.heldBalance, currency: card.currency, cardId: card._id, status: card.status } : null;
  },

  async debitForEscrow(userId, amount, referenceId, metadata = {}, session = null) {
    const card = await VirtualCard.findOne({ user: userId }).session(session);
    if (!card) return null;
    const debit = Math.round(Number(amount) * 100) / 100;
    const before = card.balance;
    card.balance = Math.max(0, Math.round((card.balance - debit) * 100) / 100);
    card.heldBalance = Math.round((card.heldBalance + debit) * 100) / 100;
    await card.save({ session });
    const [entry] = await WalletLedgerEntry.create([{ entryNumber: ref('LED'), user: userId, card: card._id, type: LEDGER_ENTRY_TYPE.CLIENT_PAYMENT, direction: 'debit', amount: debit, currency: card.currency, referenceType: 'ESCROW_FUNDING', referenceId, balanceAfter: card.balance, description: 'Client payment moved into milestone escrow', metadata: { ...metadata, balanceBefore: before, heldBalance: card.heldBalance } }], { session });
    return { card, entry };
  },

  async releaseEscrow(userId, amount, referenceId, metadata = {}, session = null) {
    const card = await VirtualCard.findOne({ user: userId }).session(session);
    if (!card) return null;
    const value = Math.round(Number(amount) * 100) / 100;
    card.heldBalance = Math.max(0, Math.round((card.heldBalance - value) * 100) / 100);
    await card.save({ session });
    return card;
  },

  async setStatus(user, status) {
    const card = await this.ensureForUser(user);
    if (!card) throw ApiError.notFound('Virtual card not found');
    if (status === 'freeze') {
      if (card.status !== VIRTUAL_CARD_STATUS.ACTIVE) throw ApiError.badRequest('Only an active card can be frozen');
      card.status = VIRTUAL_CARD_STATUS.SUSPENDED; card.frozenAt = new Date();
    } else if (status === 'unfreeze') {
      if (card.status !== VIRTUAL_CARD_STATUS.SUSPENDED) throw ApiError.badRequest('Card is not frozen');
      card.status = card.balance >= card.activationMinimum ? VIRTUAL_CARD_STATUS.ACTIVE : VIRTUAL_CARD_STATUS.INACTIVE; card.frozenAt = undefined;
    } else throw ApiError.badRequest('Unsupported card action');
    await card.save();
    return card;
  },

  async creditEarning(userId, amount, referenceId, metadata = {}, session = null) {
    const card = await VirtualCard.findOne({ user: userId }).session(session);
    if (!card) throw ApiError.badRequest('Developer virtual card not found');
    const before = card.balance;
    card.balance += Math.round(Number(amount) * 100) / 100;
    if (card.status === VIRTUAL_CARD_STATUS.INACTIVE && card.balance >= card.activationMinimum) { card.status = VIRTUAL_CARD_STATUS.ACTIVE; card.activatedAt = card.activatedAt || new Date(); }
    await card.save({ session });
    const [entry] = await WalletLedgerEntry.create([{ entryNumber: ref('LED'), user: userId, card: card._id, type: LEDGER_ENTRY_TYPE.DEVELOPER_EARNING, direction: 'credit', amount, currency: card.currency, referenceType: 'ESCROW_RELEASE', referenceId, balanceAfter: card.balance, description: 'Developer earnings', metadata: { ...metadata, balanceBefore: before } }], { session });
    return entry;
  },
};

export async function developerEligibility(user) {
  return virtualCardService.eligibility(user);
}

import crypto from 'node:crypto';
import { PaymentTransaction, SIMULATED_PAYMENT_STATUS, SIMULATED_PROVIDER } from '../models/PaymentTransaction.js';
import { ROLES } from '../models/User.js';
import { VirtualCard, VIRTUAL_CARD_STATUS } from '../models/VirtualCard.js';
import { LEDGER_ENTRY_TYPE, WalletLedgerEntry } from '../models/WalletLedgerEntry.js';
import { ApiError } from '../utils/ApiError.js';

const providers = new Set(Object.values(SIMULATED_PROVIDER));
const activationMinimum = 500;

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ref(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function cardTypeFor(user) {
  if (user?.hasRole?.(ROLES.CLIENT)) return 'client';
  if (user?.hasRole?.(ROLES.FREELANCER)) return 'developer';
  throw ApiError.forbidden('Virtual cards are available only to clients and developers');
}

function roleLabel(type) {
  return type === 'client' ? 'Client' : 'Developer';
}

export const virtualCardService = {
  async ensureForUser(user) {
    const cardType = cardTypeFor(user);
    const existing = await VirtualCard.findOne({ user: user._id });
    if (existing) return existing;

    const seed = crypto.randomBytes(8).toString('hex').toUpperCase();
    const lastFour = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const prefix = cardType === 'client' ? '5489' : '4928';
    const internalNumber = `GG${cardType.toUpperCase()}${seed}${lastFour}`;

    try {
      return await VirtualCard.create({
        user: user._id,
        cardType,
        maskedCardNumber: `${prefix} **** **** ${lastFour}`,
        cardNumberHash: hash(internalNumber),
        expiryMonth: new Date().getMonth() + 1,
        expiryYear: new Date().getFullYear() + 5,
        activationMinimum,
      });
    } catch (error) {
      if (error?.code === 11000) return VirtualCard.findOne({ user: user._id });
      throw error;
    }
  },

  async getMine(user) {
    const card = await this.ensureForUser(user);
    return card.populate('user', 'name role roles');
  },

  async reload(user, { amount, provider, outcome = 'success' }, idempotencyKey) {
    if (!idempotencyKey) throw ApiError.badRequest('Idempotency-Key is required');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw ApiError.badRequest('Reload amount must be greater than zero');
    if (!providers.has(provider)) throw ApiError.badRequest('Unsupported simulated payment provider');

    const card = await this.ensureForUser(user);
    if ([VIRTUAL_CARD_STATUS.SUSPENDED, VIRTUAL_CARD_STATUS.BLOCKED, VIRTUAL_CARD_STATUS.CANCELLED].includes(card.status)) {
      throw ApiError.badRequest('Your card is not available for reload');
    }

    const prior = await PaymentTransaction.findOne({ idempotencyKey });
    if (prior) return { payment: prior, card };

    const payment = await PaymentTransaction.create({
      transactionNumber: ref('PAY'),
      user: user._id,
      card: card._id,
      amount: Math.round(amount * 100) / 100,
      currency: card.currency,
      provider,
      providerTransactionId: ref('SIM'),
      type: card.cardType === 'client' ? 'client_funding' : 'card_reload',
      status: outcome === 'failed' ? SIMULATED_PAYMENT_STATUS.FAILED : SIMULATED_PAYMENT_STATUS.SUCCESS,
      idempotencyKey,
      metadata: { simulated: true, cardType: card.cardType },
      completedAt: outcome === 'failed' ? undefined : new Date(),
    });

    if (payment.status === SIMULATED_PAYMENT_STATUS.FAILED) return { payment, card };

    card.balance += payment.amount;
    if (card.status === VIRTUAL_CARD_STATUS.INACTIVE && card.balance >= card.activationMinimum) {
      card.status = VIRTUAL_CARD_STATUS.ACTIVE;
      card.activatedAt = card.activatedAt || new Date();
    }
    await card.save();

    await WalletLedgerEntry.create({
      entryNumber: ref('LED'),
      user: user._id,
      card: card._id,
      type: card.cardType === 'client' ? LEDGER_ENTRY_TYPE.CLIENT_FUNDING : LEDGER_ENTRY_TYPE.CARD_RELOAD,
      direction: 'credit',
      amount: payment.amount,
      currency: card.currency,
      referenceType: 'PAYMENT',
      referenceId: payment._id,
      balanceAfter: card.balance,
      description: `${roleLabel(card.cardType)} simulated funding via ${provider.replace('_SIMULATED', '')}`,
    });

    return { payment, card };
  },

  async transactions(user) {
    const card = await this.ensureForUser(user);
    return WalletLedgerEntry.find({ user: user._id, card: card._id }).sort({ createdAt: -1 }).limit(100);
  },

  async eligibility(user) {
    const card = await this.ensureForUser(user);
    const active = card.status === VIRTUAL_CARD_STATUS.ACTIVE;
    const amountRequired = Math.max(0, card.activationMinimum - card.balance);
    return {
      card: card.toJSON(),
      canUseMarketplace: active,
      canPostJobs: card.cardType === 'client' && active,
      canApplyForJobs: card.cardType === 'developer' && active,
      reason: active ? undefined : card.status === VIRTUAL_CARD_STATUS.SUSPENDED ? 'CARD_SUSPENDED' : 'CARD_ACTIVATION_REQUIRED',
      amountRequired,
    };
  },

  async setStatus(user, action) {
    const card = await this.ensureForUser(user);
    if (action === 'freeze') {
      if (card.status !== VIRTUAL_CARD_STATUS.ACTIVE) throw ApiError.badRequest('Only an active card can be frozen');
      card.status = VIRTUAL_CARD_STATUS.SUSPENDED;
      card.frozenAt = new Date();
    } else if (action === 'unfreeze') {
      if (card.status !== VIRTUAL_CARD_STATUS.SUSPENDED) throw ApiError.badRequest('Card is not frozen');
      card.status = card.balance >= card.activationMinimum ? VIRTUAL_CARD_STATUS.ACTIVE : VIRTUAL_CARD_STATUS.INACTIVE;
      card.frozenAt = undefined;
    } else {
      throw ApiError.badRequest('Unsupported card action');
    }
    await card.save();
    return card;
  },
};

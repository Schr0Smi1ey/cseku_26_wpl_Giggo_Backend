import { notificationService } from '../services/notification.service.js';
import { emitToUser } from '../services/realtime.service.js';
import { virtualCardService } from '../services/virtualCard.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const virtualCardController = {
  me: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.getMine(req.user) })),
  create: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.getMine(req.user) }, 'Virtual card ready', 201)),
  activate: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.activate(req.user) }, 'Card activated')),
  reload: asyncHandler(async (req, res) => {
    const result = await virtualCardService.reload(req.user, req.body, req.get('Idempotency-Key'));
    const succeeded = result.payment.status === 'success';
    emitToUser(req.user._id, succeeded ? 'wallet:updated' : 'payment:failed', { card: result.card, payment: result.payment });
    await notificationService.publish({
      recipient: req.user._id,
      type: succeeded ? 'card_reload_success' : 'card_reload_failed',
      category: 'payments',
      title: succeeded ? 'Card reload successful' : 'Card reload failed',
      body: succeeded ? `Your simulated reload of ${result.payment.amount} ${result.payment.currency} completed.` : 'Your simulated reload failed. Your balance was not changed.',
      entityType: 'payment',
      entityId: result.payment._id,
      actionUrl: '/dashboard/card',
    }).catch(() => null);
    return ok(res, result, 'Simulated reload processed', 201);
  }),
  transactions: asyncHandler(async (req, res) => ok(res, { transactions: await virtualCardService.transactions(req.user) })),
  wallet: asyncHandler(async (req, res) => ok(res, { wallet: await virtualCardService.wallet(req.user) })),
  eligibility: asyncHandler(async (req, res) => ok(res, await virtualCardService.eligibility(req.user))),
  freeze: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.setStatus(req.user, 'freeze') }, 'Card frozen')),
  unfreeze: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.setStatus(req.user, 'unfreeze') }, 'Card unfrozen')),
};

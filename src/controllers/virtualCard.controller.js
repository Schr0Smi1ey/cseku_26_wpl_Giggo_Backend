import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { virtualCardService } from '../services/virtualCard.service.js';

export const virtualCardController = {
  me: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.getMine(req.user) })),
  reload: asyncHandler(async (req, res) => ok(res, await virtualCardService.reload(req.user, req.body, req.get('Idempotency-Key')), 'Simulated reload processed', 201)),
  transactions: asyncHandler(async (req, res) => ok(res, { transactions: await virtualCardService.transactions(req.user) })),
  eligibility: asyncHandler(async (req, res) => ok(res, await virtualCardService.eligibility(req.user))),
  freeze: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.setStatus(req.user, 'freeze') }, 'Card frozen')),
  unfreeze: asyncHandler(async (req, res) => ok(res, { card: await virtualCardService.setStatus(req.user, 'unfreeze') }, 'Card unfrozen')),
};

import { offerService } from '../services/offer.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const offerController = {
  create: asyncHandler(async (req, res) => ok(res, { offer: await offerService.create(req.user, req.body) }, 'Offer draft created', 201)),
  list: asyncHandler(async (req, res) => ok(res, await offerService.list(req.user, req.query))),
  getOne: asyncHandler(async (req, res) => ok(res, { offer: await offerService.get(req.user, req.params.id) })),
  update: asyncHandler(async (req, res) => ok(res, { offer: await offerService.update(req.user, req.params.id, req.body) }, 'Offer revised')),
  send: asyncHandler(async (req, res) => ok(res, { offer: await offerService.send(req.user, req.params.id) }, 'Offer sent')),
  sendMessage: asyncHandler(async (req, res) => ok(res, { message: await offerService.sendMessage(req.user, req.params.id, req.body.message) }, 'Message sent', 201)),
  requestChanges: asyncHandler(async (req, res) => ok(res, { offer: await offerService.requestChanges(req.user, req.params.id, req.body.message) }, 'Changes requested')),
  reject: asyncHandler(async (req, res) => ok(res, { offer: await offerService.reject(req.user, req.params.id) }, 'Offer declined')),
  withdraw: asyncHandler(async (req, res) => ok(res, { offer: await offerService.withdraw(req.user, req.params.id) }, 'Offer withdrawn')),
  accept: asyncHandler(async (req, res) => ok(res, { offer: await offerService.accept(req.user, req.params.id, req.body.revision) }, 'Offer accepted')),
};

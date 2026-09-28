import { contractService } from '../services/contract.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const contractController = {
  list: asyncHandler(async (req, res) => ok(res, await contractService.list(req.user, req.query))),
  getOne: asyncHandler(async (req, res) => ok(res, { contract: await contractService.get(req.user, req.params.id) })),
  transition: asyncHandler(async (req, res) => ok(res, { contract: await contractService.transition(req.user, req.params.id, req.body) }, 'Contract status updated')),
};

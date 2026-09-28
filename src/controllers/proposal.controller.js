import { proposalService } from '../services/proposal.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const proposalController = {
  create: asyncHandler(async (req, res) => ok(
    res,
    { proposal: (await proposalService.create(req.user, req.body)).toJSON() },
    'Proposal submitted',
    201,
  )),
  mineForJob: asyncHandler(async (req, res) => {
    const proposal = await proposalService.findMineForJob(req.user, req.params.jobId);
    return ok(res, { proposal: proposal ? proposal.toJSON() : null });
  }),
  listMine: asyncHandler(async (req, res) => {
    const result = await proposalService.listMine(req.user, req.query);
    return ok(res, { ...result, items: result.items.map((proposal) => proposal.toJSON()) });
  }),
  listReceived: asyncHandler(async (req, res) => ok(res, await proposalService.listReceived(req.user, req.query))),
  getOne: asyncHandler(async (req, res) => ok(res, { proposal: await proposalService.getById(req.user, req.params.id) })),
  update: asyncHandler(async (req, res) => ok(
    res,
    { proposal: (await proposalService.update(req.user, req.params.id, req.body)).toJSON() },
    'Proposal updated',
  )),
  withdraw: asyncHandler(async (req, res) => ok(
    res,
    { proposal: (await proposalService.withdraw(req.user, req.params.id)).toJSON() },
    'Proposal withdrawn',
  )),
  decide: asyncHandler(async (req, res) => ok(
    res,
    { proposal: (await proposalService.decide(req.user, req.params.id, req.body)).toJSON() },
    'Proposal updated',
  )),
};

import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { jobService } from '../services/job.service.js';
const collection = (value) => ({ items: value.items.map((item) => item.toJSON()), pagination: value.pagination });
export const jobController = {
  create: asyncHandler(async (req, res) => ok(res, { job: (await jobService.create(req.user, req.body)).toJSON() }, 'Job posted', 201)),
  list: asyncHandler(async (req, res) => ok(res, collection(await jobService.list(req.query)))),
  get: asyncHandler(async (req, res) => ok(res, { job: (await jobService.get(req.user, req.params.id)).toJSON() })),
  mine: asyncHandler(async (req, res) => ok(res, collection(await jobService.mine(req.user, req.query)))),
  update: asyncHandler(async (req, res) => ok(res, { job: (await jobService.update(req.user, req.params.id, req.body)).toJSON() }, 'Job updated')),
  remove: asyncHandler(async (req, res) => ok(res, await jobService.remove(req.user, req.params.id))),
  save: asyncHandler(async (req, res) => ok(res, await jobService.save(req.user, req.params.id))),
  unsave: asyncHandler(async (req, res) => ok(res, await jobService.unsave(req.user, req.params.id))),
  saved: asyncHandler(async (req, res) => ok(res, collection(await jobService.saved(req.user, req.query)))),
};

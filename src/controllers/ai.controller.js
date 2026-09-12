import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { aiService } from '../services/ai.service.js';

const pageData = ({ items, total, page, limit }) => ({ items: items.map((item) => item.toJSON()), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
export const aiController = {
  analyze: asyncHandler(async (req, res) => ok(res, { analysis: (await aiService.analyzeCv(req.user, req.body)).toJSON() }, 'CV analyzed', 201)),
  latest: asyncHandler(async (req, res) => { const analysis = await aiService.latest(req.user); return ok(res, { analysis: analysis?.toJSON() || null }); }),
  list: asyncHandler(async (req, res) => ok(res, pageData(await aiService.list(req.user, req.query)))),
  get: asyncHandler(async (req, res) => ok(res, { analysis: (await aiService.get(req.user, req.params.id)).toJSON() })),
  remove: asyncHandler(async (req, res) => ok(res, await aiService.remove(req.user, req.params.id))),
  applySkills: asyncHandler(async (req, res) => { const result = await aiService.applySkills(req.user, req.params.id); return ok(res, { profile: result.profile.toJSON(), added: result.added }); }),
};

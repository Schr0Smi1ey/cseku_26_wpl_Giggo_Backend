import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const authController = {
  me: asyncHandler(async (req, res) => ok(res, { user: req.user.toJSON() })),
};

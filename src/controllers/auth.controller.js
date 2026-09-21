import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { accountDeletionService } from '../services/account-deletion.service.js';

export const authController = {
  me: asyncHandler(async (req, res) => ok(res, { user: req.user.toJSON() })),
  deleteAccount: asyncHandler(async (req, res) => ok(
    res,
    await accountDeletionService.remove(req.user, req.authIdentity),
    'Account permanently deleted',
  )),
};

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { deleteAccountSchema } from '../validators/auth.validators.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();
const accountDeletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'Too many account deletion attempts. Try again later.', 'RATE_LIMITED')),
});

router.get('/me', requireAuth, authController.me);
router.delete('/account', requireAuth, accountDeletionLimiter, validate(deleteAccountSchema), authController.deleteAccount);

export default router;

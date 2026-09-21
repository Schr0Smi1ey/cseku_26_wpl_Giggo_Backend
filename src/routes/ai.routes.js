import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { aiController } from '../controllers/ai.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { analysisIdSchema, analysisQuerySchema, analyzeCvSchema, proposalDraftSchema } from '../validators/ai.validators.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();

function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    req.params = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    req.query = result.data;
    return next();
  };
}

const draftLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'Too many draft requests. Try again later.', 'RATE_LIMITED')),
});

router.use(requireAuth, requireRole(ROLES.FREELANCER));
router.post('/cv/analyze', validate(analyzeCvSchema), aiController.analyze);
router.get('/cv/latest', aiController.latest);
router.get('/cv/analyses', validateQuery(analysisQuerySchema), aiController.list);
router.get('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.get);
router.delete('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.remove);
router.post('/cv/analyses/:id/apply-skills', validateParams(analysisIdSchema), aiController.applySkills);
router.post('/proposal/draft', draftLimiter, validate(proposalDraftSchema), aiController.draftProposal);

export default router;

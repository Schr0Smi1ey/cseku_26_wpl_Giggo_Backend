import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { proposalController } from '../controllers/proposal.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createProposalSchema,
  myProposalsQuerySchema,
  proposalDecisionSchema,
  proposalIdParamsSchema,
  proposalJobParamsSchema,
  receivedProposalsQuerySchema,
  updateProposalSchema,
} from '../validators/proposal.validators.js';

const router = Router();
const params = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.params);
  if (!result.success) return next(result.error);
  req.params = result.data;
  return next();
};
const query = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) return next(result.error);
  req.query = result.data;
  return next();
};
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'Too many proposal attempts. Try again later.', 'RATE_LIMITED')),
});

router.use(requireAuth);
router.get('/mine', requireRole(ROLES.FREELANCER), query(myProposalsQuerySchema), proposalController.listMine);
router.get('/received', requireRole(ROLES.CLIENT), query(receivedProposalsQuerySchema), proposalController.listReceived);
router.get('/jobs/:jobId/mine', requireRole(ROLES.FREELANCER), params(proposalJobParamsSchema), proposalController.mineForJob);
router.post('/', requireRole(ROLES.FREELANCER), submissionLimiter, validate(createProposalSchema), proposalController.create);
router.patch('/:id', requireRole(ROLES.FREELANCER), params(proposalIdParamsSchema), validate(updateProposalSchema), proposalController.update);
router.post('/:id/withdraw', requireRole(ROLES.FREELANCER), params(proposalIdParamsSchema), proposalController.withdraw);
router.post('/:id/decision', requireRole(ROLES.CLIENT), params(proposalIdParamsSchema), validate(proposalDecisionSchema), proposalController.decide);
router.get('/:id', params(proposalIdParamsSchema), proposalController.getOne);

export default router;

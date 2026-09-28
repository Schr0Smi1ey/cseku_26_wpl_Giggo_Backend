import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { offerController } from '../controllers/offer.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import {
  acceptOfferSchema,
  createOfferSchema,
  offerMessageSchema,
  offerIdParamsSchema,
  offersQuerySchema,
  requestOfferChangesSchema,
  updateOfferSchema,
} from '../validators/offer.validators.js';

const router = Router();
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many offer messages. Please wait before trying again.', code: 'RATE_LIMITED' },
});
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

router.use(requireAuth);
router.use(requireRole(ROLES.CLIENT, ROLES.FREELANCER));
router.get('/', query(offersQuerySchema), offerController.list);
router.post('/', requireRole(ROLES.CLIENT), validate(createOfferSchema), offerController.create);
router.get('/:id', params(offerIdParamsSchema), offerController.getOne);
router.post('/:id/messages', messageLimiter, params(offerIdParamsSchema), validate(offerMessageSchema), offerController.sendMessage);
router.patch('/:id', requireRole(ROLES.CLIENT), params(offerIdParamsSchema), validate(updateOfferSchema), offerController.update);
router.post('/:id/send', requireRole(ROLES.CLIENT), params(offerIdParamsSchema), offerController.send);
router.post('/:id/withdraw', requireRole(ROLES.CLIENT), params(offerIdParamsSchema), offerController.withdraw);
router.post('/:id/accept', requireRole(ROLES.FREELANCER), params(offerIdParamsSchema), validate(acceptOfferSchema), offerController.accept);
router.post('/:id/reject', requireRole(ROLES.FREELANCER), params(offerIdParamsSchema), offerController.reject);
router.post('/:id/request-changes', requireRole(ROLES.FREELANCER), params(offerIdParamsSchema), validate(requestOfferChangesSchema), offerController.requestChanges);

export default router;

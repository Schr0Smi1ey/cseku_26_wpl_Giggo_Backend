import { Router } from 'express';
import { paymentController as c } from '../controllers/payment.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { fundSchema, milestoneParamsSchema, paymentParamsSchema, simulatedFundSchema } from '../validators/payment.validators.js';

const router = Router();
const validatePart = (part, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  req[part] = result.data;
  return next();
};

router.post('/payments/simulate', requireAuth, validate(simulatedFundSchema), c.simulate);
router.post('/milestones/:milestoneId/fund', requireAuth, validatePart('params', milestoneParamsSchema), validate(fundSchema), c.fund);
router.post('/milestones/:milestoneId/release', requireAuth, validatePart('params', milestoneParamsSchema), c.release);
router.get('/payments', requireAuth, c.list);
router.get('/payments/:id', requireAuth, validatePart('params', paymentParamsSchema), c.get);
router.get('/wallet', requireAuth, c.wallet);
router.get('/wallet/transactions', requireAuth, c.transactions);

export default router;

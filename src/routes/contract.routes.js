import { Router } from 'express';
import { contractController } from '../controllers/contract.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { contractIdParamsSchema, contractsQuerySchema, contractTransitionSchema } from '../validators/contract.validators.js';

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

router.use(requireAuth);
router.use(requireRole(ROLES.CLIENT, ROLES.FREELANCER));
router.get('/', query(contractsQuerySchema), contractController.list);
router.get('/:id', params(contractIdParamsSchema), contractController.getOne);
router.post('/:id/status', params(contractIdParamsSchema), validate(contractTransitionSchema), contractController.transition);

export default router;

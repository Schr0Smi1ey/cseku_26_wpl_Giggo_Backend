import { Router } from 'express';
import { projectController } from '../controllers/project.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { projectIdParamsSchema, projectProgressSchema, projectsQuerySchema } from '../validators/project.validators.js';

const router = Router();
const validatePart = (part, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  req[part] = result.data;
  return next();
};

router.use(requireAuth);
router.use(requireRole(ROLES.CLIENT, ROLES.FREELANCER));
router.get('/', validatePart('query', projectsQuerySchema), projectController.list);
router.get('/:id', validatePart('params', projectIdParamsSchema), projectController.getOne);
router.patch('/:id/progress', validatePart('params', projectIdParamsSchema), validate(projectProgressSchema), projectController.updateProgress);

export default router;

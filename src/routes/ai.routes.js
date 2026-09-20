import { Router } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { analysisIdSchema, analysisQuerySchema, analyzeCvSchema } from '../validators/ai.validators.js';

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

router.use(requireAuth, requireRole(ROLES.FREELANCER));
router.post('/cv/analyze', validate(analyzeCvSchema), aiController.analyze);
router.get('/cv/latest', aiController.latest);
router.get('/cv/analyses', validateQuery(analysisQuerySchema), aiController.list);
router.get('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.get);
router.delete('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.remove);
router.post('/cv/analyses/:id/apply-skills', validateParams(analysisIdSchema), aiController.applySkills);

export default router;

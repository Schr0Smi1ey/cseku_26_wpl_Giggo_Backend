import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { aiController } from '../controllers/ai.controller.js';
import { analyzeCvSchema, analysisIdSchema, analysisQuerySchema } from '../validators/ai.validators.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';

const router = Router();
const validateParams = (schema) => (req, _res, next) => { const result = schema.safeParse(req.params); if (!result.success) return next(result.error); req.params = result.data; return next(); };
const validateQuery = (schema) => (req, _res, next) => { const result = schema.safeParse(req.query); if (!result.success) return next(result.error); req.query = result.data; return next(); };
router.use(requireAuth, requireRole(ROLES.FREELANCER));
router.post('/cv/analyze', validate(analyzeCvSchema), aiController.analyze);
router.get('/cv/latest', aiController.latest);
router.get('/cv/analyses', validateQuery(analysisQuerySchema), aiController.list);
router.get('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.get);
router.delete('/cv/analyses/:id', validateParams(analysisIdSchema), aiController.remove);
router.post('/cv/analyses/:id/apply-skills', validateParams(analysisIdSchema), aiController.applySkills);
export default router;

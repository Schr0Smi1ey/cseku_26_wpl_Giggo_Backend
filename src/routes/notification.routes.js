import { Router } from 'express';
import { notificationController as controller } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { notificationIdParamsSchema, notificationListSchema, notificationPreferenceSchema } from '../validators/conversation.validators.js';

const router = Router();
const validatePart = (part, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  req[part] = result.data;
  return next();
};

router.use(requireAuth);
router.get('/', validatePart('query', notificationListSchema), controller.list);
router.post('/read-all', controller.readAll);
router.patch('/:id/read', validatePart('params', notificationIdParamsSchema), controller.read);
router.patch('/:id/archive', validatePart('params', notificationIdParamsSchema), controller.archive);
router.get('/preferences/me', controller.preferences);
router.patch('/preferences/me', validate(notificationPreferenceSchema), controller.updatePreferences);

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { conversationController as controller } from '../controllers/conversation.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ApiError } from '../utils/ApiError.js';
import {
  addParticipantSchema,
  contactsQuerySchema,
  conversationIdParamsSchema,
  conversationListSchema,
  conversationSettingsSchema,
  createConversationSchema,
  createMessageSchema,
  editMessageSchema,
  messageIdParamsSchema,
  messageListSchema,
  participantParamsSchema,
  reactionSchema,
} from '../validators/conversation.validators.js';

const router = Router();
const validatePart = (part, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  req[part] = result.data;
  return next();
};
const params = (schema) => validatePart('params', schema);
const query = (schema) => validatePart('query', schema);
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'Too many messages. Please wait before trying again.', 'RATE_LIMITED')),
});

router.use(requireAuth);
router.get('/contacts', query(contactsQuerySchema), controller.contacts);
router.get('/', query(conversationListSchema), controller.list);
router.post('/', validate(createConversationSchema), controller.create);
router.patch('/messages/:messageId', params(messageIdParamsSchema), validate(editMessageSchema), controller.edit);
router.delete('/messages/:messageId', params(messageIdParamsSchema), controller.remove);
router.post('/messages/:messageId/reaction', params(messageIdParamsSchema), validate(reactionSchema), controller.react);
router.post('/messages/:messageId/pin', params(messageIdParamsSchema), controller.pin);
router.post('/messages/:messageId/save', params(messageIdParamsSchema), controller.save);
router.get('/:conversationId', params(conversationIdParamsSchema), controller.get);
router.patch('/:conversationId/settings', params(conversationIdParamsSchema), validate(conversationSettingsSchema), controller.settings);
router.post('/:conversationId/participants', params(conversationIdParamsSchema), validate(addParticipantSchema), controller.addParticipant);
router.delete('/:conversationId/participants/:userId', params(participantParamsSchema), controller.removeParticipant);
router.get('/:conversationId/messages', params(conversationIdParamsSchema), query(messageListSchema), controller.messages);
router.post('/:conversationId/messages', messageLimiter, params(conversationIdParamsSchema), validate(createMessageSchema), controller.send);
router.post('/:conversationId/read', params(conversationIdParamsSchema), controller.read);

export default router;

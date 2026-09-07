import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { handleUploadError, uploadVerificationDocuments } from '../middlewares/upload.js';
import { ROLES } from '../models/User.js';
import { verificationController } from '../controllers/verification.controller.js';
import {
  validateDocumentIndex,
  validatePhone,
  validatePhoneCode,
  validateRequestId,
  validateVerificationDecision,
  validateVerificationQueue,
  validateVerificationRequest,
} from '../validators/verification.validators.js';

const router = Router();
const verificationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.use(requireAuth);

router.get('/status', requireRole(ROLES.FREELANCER), verificationController.status);
router.post('/email/resend', requireRole(ROLES.FREELANCER), verificationLimiter, verificationController.resendEmail);
router.post('/phone/send', requireRole(ROLES.FREELANCER), verificationLimiter, validatePhone, verificationController.sendPhone);
router.post('/phone/verify', requireRole(ROLES.FREELANCER), validatePhoneCode, verificationController.verifyPhone);
router.post('/requests', requireRole(ROLES.FREELANCER), uploadVerificationDocuments, handleUploadError, validateVerificationRequest, verificationController.submitRequest);
router.get('/requests', requireRole(ROLES.FREELANCER), verificationController.myRequests);
router.delete('/requests/:id', requireRole(ROLES.FREELANCER), validateRequestId, verificationController.cancelRequest);

router.get('/admin/requests', requireRole(ROLES.ADMIN), validateVerificationQueue, verificationController.adminQueue);
router.post('/admin/requests/:id/decision', requireRole(ROLES.ADMIN), validateRequestId, validateVerificationDecision, verificationController.adminDecide);
router.get('/admin/requests/:id/documents/:index', requireRole(ROLES.ADMIN), validateDocumentIndex, verificationController.adminDocument);

export default router;

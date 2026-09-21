import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middlewares/auth.js';
import { profileController } from '../controllers/profile.controller.js';
import { validateProfile, validateTalentQuery } from '../validators/profile.validators.js';
import { handleAvatarUploadError, handleCvUploadError, uploadAvatarImage, uploadCvDocument } from '../middlewares/upload.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();
const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'Too many profile photo uploads. Try again later.', 'RATE_LIMITED')),
});

router.get('/talent', validateTalentQuery, profileController.listTalent);
router.get('/avatars/:filename', profileController.serveAvatar);
router.get('/me', requireAuth, profileController.getMine);
router.patch('/me', requireAuth, validateProfile('patch'), profileController.updateMine);
router.post('/me/onboarding', requireAuth, validateProfile('onboarding'), profileController.completeOnboarding);
router.post('/me/avatar', requireAuth, avatarUploadLimiter, uploadAvatarImage, handleAvatarUploadError, profileController.uploadAvatar);
router.delete('/me/avatar', requireAuth, profileController.removeAvatar);
router.post('/me/cv', requireAuth, uploadCvDocument, handleCvUploadError, profileController.uploadCv);
router.delete('/me/cv', requireAuth, profileController.removeCv);
router.get('/:userId', profileController.getPublic);

export default router;

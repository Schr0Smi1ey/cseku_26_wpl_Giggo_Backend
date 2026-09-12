import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { profileController } from '../controllers/profile.controller.js';
import { validateProfile, validateTalentQuery } from '../validators/profile.validators.js';
import { uploadCvDocument, handleUploadError } from '../middlewares/upload.js';

const router = Router();

router.get('/talent', validateTalentQuery, profileController.listTalent);
router.get('/me', requireAuth, profileController.getMine);
router.patch('/me', requireAuth, validateProfile('patch'), profileController.updateMine);
router.post('/me/onboarding', requireAuth, validateProfile('onboarding'), profileController.completeOnboarding);
router.post('/me/cv', requireAuth, uploadCvDocument, handleUploadError, profileController.uploadCv);
router.delete('/me/cv', requireAuth, profileController.removeCv);
router.get('/:userId', profileController.getPublic);

export default router;

import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { profileController } from '../controllers/profile.controller.js';
import { validateProfile, validateTalentQuery } from '../validators/profile.validators.js';

const router = Router();

router.get('/talent', validateTalentQuery, profileController.listTalent);
router.get('/me', requireAuth, profileController.getMine);
router.patch('/me', requireAuth, validateProfile('patch'), profileController.updateMine);
router.post('/me/onboarding', requireAuth, validateProfile('onboarding'), profileController.completeOnboarding);
router.get('/:userId', profileController.getPublic);

export default router;

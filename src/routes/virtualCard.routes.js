import { Router } from 'express';
import { virtualCardController as c } from '../controllers/virtualCard.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { reloadSchema } from '../validators/virtualCard.validators.js';

const router = Router();
const requireDeveloperCard = (req, _res, next) => (req.user?.hasRole(ROLES.FREELANCER)
  ? next()
  : next(new ApiError(403, 'Virtual card information is available only to developers.', 'DEVELOPER_CARD_ACCESS_REQUIRED')));

router.get('/cards/me', requireAuth, c.me);
router.post('/cards/create', requireAuth, c.create);
router.post('/cards/activate', requireAuth, requireDeveloperCard, c.activate);
router.post('/cards/freeze', requireAuth, c.freeze);
router.post('/cards/unfreeze', requireAuth, c.unfreeze);
router.get('/cards/me/transactions', requireAuth, c.transactions);
router.get('/wallet/me', requireAuth, c.wallet);
router.get('/wallet/ledger', requireAuth, c.transactions);
router.post('/wallet/reload', requireAuth, requireDeveloperCard, validate(reloadSchema), c.reload);
router.get('/developers/me/eligibility', requireAuth, requireDeveloperCard, c.eligibility);

export default router;

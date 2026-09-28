import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { virtualCardController as c } from '../controllers/virtualCard.controller.js';
import { reload } from '../validators/virtualCard.validators.js';

const router = Router();

router.use(requireAuth);
router.get('/cards/me', c.me);
router.post('/cards/freeze', c.freeze);
router.post('/cards/unfreeze', c.unfreeze);
router.get('/cards/me/transactions', c.transactions);
router.post('/wallet/reload', validate(reload), c.reload);
router.get('/wallet/ledger', c.transactions);
router.get('/cards/me/eligibility', c.eligibility);

export default router;

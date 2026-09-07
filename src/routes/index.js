import { Router } from 'express';
import authRoutes from './auth.routes.js';
import profileRoutes from './profile.routes.js';
import verificationRoutes from './verification.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, message: 'ok', data: { status: 'healthy' } }));
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/verification', verificationRoutes);

export default router;

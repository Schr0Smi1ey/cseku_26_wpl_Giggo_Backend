import { Router } from 'express';
import authRoutes from './auth.routes.js';
import profileRoutes from './profile.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, message: 'ok', data: { status: 'healthy' } }));
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);

export default router;

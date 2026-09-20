import { Router } from 'express';
import authRoutes from './auth.routes.js';
import profileRoutes from './profile.routes.js';
import verificationRoutes from './verification.routes.js';
import aiRoutes from './ai.routes.js';
import jobRoutes from './job.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, message: 'ok', data: { status: 'healthy' } }));
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/verification', verificationRoutes);
router.use('/ai', aiRoutes);
router.use('/jobs', jobRoutes);

export default router;

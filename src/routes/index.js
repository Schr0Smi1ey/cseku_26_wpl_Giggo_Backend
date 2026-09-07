import { Router } from 'express';
import authRoutes from './auth.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, message: 'ok', data: { status: 'healthy' } }));
router.use('/auth', authRoutes);

export default router;

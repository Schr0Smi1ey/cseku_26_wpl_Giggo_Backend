import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config/index.js';
import { errorHandler, notFound } from './middlewares/error.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Vercel terminates the HTTPS connection at one trusted proxy hop.
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = performance.now();
    res.on('finish', () => {
      if (config.nodeEnv !== 'test' && process.env.NODE_ENV !== 'test') console.info(JSON.stringify({ event: 'http_request', requestId: req.requestId, method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    });
    next();
  });
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: true, legacyHeaders: false, skip: req => req.path.startsWith('/health') }));
  app.use(cookieParser());
  app.get('/api/health/live', (_req, res) => res.json({ success: true, data: { status: 'alive' } }));
  app.get('/api/health/ready', (_req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ success: mongoose.connection.readyState === 1, data: { status: mongoose.connection.readyState === 1 ? 'ready' : 'unavailable' } }));
  app.use('/api', apiRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// Vercel invokes this Express application as a stateless Node.js Function.
// The local development server remains at src/server.js.
const app = createApp();
let connectionPromise;

export default async function handler(req, res) {
  if (req.url?.split('?')[0] === '/api/health/live') return app(req, res);
  try {
    connectionPromise ||= connectDB().catch((error) => {
      connectionPromise = null;
      throw error;
    });
    await connectionPromise;
    return app(req, res);
  } catch {
    return res.status(503).json({ success: false, message: 'Database connection is temporarily unavailable', error: { code: 'DATABASE_UNAVAILABLE' } });
  }
}

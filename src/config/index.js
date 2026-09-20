import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) ? value : fallback;
}

const clientOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  env,
  isProduction,
  isTest,
  port: numberFromEnv('PORT', 5000),
  // Tests must never use the developer's configured Atlas database.
  mongoUri: isTest ? process.env.TEST_MONGODB_URI || '' : process.env.MONGODB_URI || '',
  mongoDbName: isTest ? undefined : process.env.MONGODB_DB_NAME || undefined,
  clientOrigins,
  bcryptCost: numberFromEnv('BCRYPT_COST', 12),
  storage: {
    verificationMaxFileMb: numberFromEnv('VERIFICATION_MAX_FILE_MB', 5),
    cvMaxFileMb: numberFromEnv('CV_MAX_FILE_MB', 10),
    avatarMaxFileMb: numberFromEnv('AVATAR_MAX_FILE_MB', 5),
    avatarUploadDir: process.env.AVATAR_UPLOAD_DIR || '',
    avatarProvider: isTest ? 'local' : process.env.AVATAR_STORAGE_PROVIDER || (process.env.IMGBB_API_KEY ? 'imgbb' : 'local'),
    imgbbApiKey: process.env.IMGBB_API_KEY || '',
    imgbbUploadTimeoutMs: numberFromEnv('IMGBB_UPLOAD_TIMEOUT_MS', 15000),
    uploadDir: process.env.UPLOAD_DIR || '',
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'heuristic',
    retention: numberFromEnv('AI_ANALYSIS_RETENTION', 50),
  },
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    adminTimeoutMs: numberFromEnv('SUPABASE_ADMIN_TIMEOUT_MS', 10000),
  },
  jwt: {
    accessSecret: process.env.JWT_SECRET || (isTest ? 'test-access-secret' : 'dev-access-secret-change-me'),
    refreshSecret: process.env.JWT_REFRESH_SECRET || (isTest ? 'test-refresh-secret' : 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: numberFromEnv('JWT_REFRESH_TTL_DAYS', 7),
  },
};

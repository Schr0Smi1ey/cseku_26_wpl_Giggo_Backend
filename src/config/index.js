import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) ? value : fallback;
}

// Capacitor Android uses http://localhost as its WebView origin. It is needed
// only for USB/local development with `adb reverse tcp:5000 tcp:5000`.
const defaultClientOrigins = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost,capacitor://localhost,https://mymensingh-hi-school.web.app,https://mymensingh-hi-school.firebaseapp.com';
const clientOrigins = `${process.env.CLIENT_URL || ''},${defaultClientOrigins},https://giggo-kucse.web.app,https://giggo-kucse.firebaseapp.com`
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  env,
  isProduction,
  isTest,
  port: numberFromEnv('PORT', 5000),
  host: process.env.HOST || '0.0.0.0',
  // Tests must never use the developer's configured Atlas database.
  mongoUri: isTest ? process.env.TEST_MONGODB_URI || '' : process.env.MONGODB_URI || '',
  mongoDbName: isTest ? undefined : process.env.MONGODB_DB_NAME || undefined,
  clientOrigins,
  bcryptCost: numberFromEnv('BCRYPT_COST', 12),
  storage: {
    verificationMaxFileMb: Math.min(numberFromEnv('VERIFICATION_MAX_FILE_MB', 3), 3),
    cvMaxFileMb: Math.min(numberFromEnv('CV_MAX_FILE_MB', 3), 3),
    avatarMaxFileMb: Math.min(numberFromEnv('AVATAR_MAX_FILE_MB', 3), 3),
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
  payment: {
    provider: 'mock',
    currency: (process.env.PAYMENT_CURRENCY || 'BDT').toUpperCase(),
    feePercentage: Number(process.env.PLATFORM_FEE_PERCENTAGE || 10),
    fixedFee: Number(process.env.PLATFORM_FIXED_FEE || 0),
  },
  virtualCard: {
    enabled: (process.env.VIRTUAL_CARD_ENABLED || 'true').toLowerCase() !== 'false',
    activationMinimum: Number(process.env.VIRTUAL_CARD_ACTIVATION_MINIMUM || 500),
    currency: (process.env.VIRTUAL_CARD_CURRENCY || 'BDT').toUpperCase(),
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

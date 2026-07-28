import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory first, then root (for monorepo workspace support)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3001',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  database: {
    url: process.env.DATABASE_URL || '',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  mfa: {
    // AES-256-GCM key for encrypting admin TOTP secrets at rest (F-9). Any string; a 32-byte hex
    // value is recommended. Setup/verify fail loudly if this is unset.
    encryptionKey: process.env.MFA_ENCRYPTION_KEY || '',
    // Hard-require admin MFA once every admin has enrolled. Default off = grace period.
    required: process.env.ADMIN_MFA_REQUIRED === 'true',
  },

  retention: {
    // GDPR-K hard-delete. DISABLED by default: the retention job only logs what it *would* purge
    // until this is explicitly turned on. Flip to true once verified against real soft-deleted data.
    purgeEnabled: process.env.RETENTION_PURGE_ENABLED === 'true',
    // Days a soft-deleted family/user is kept before hard deletion.
    days: parseInt(process.env.RETENTION_DAYS || '30', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // P0-2: the oldest native build each platform may still run. GET /meta/min-version compares the
  // caller's X-Client version against these and tells the app to hard-block below them — the only
  // lever we have to kill a broken release without waiting on a store rollout. Defaults of 0.0.0
  // block nothing, which is the correct posture until a release actually needs retiring.
  mobile: {
    minVersion: {
      'taskbuddy-android': process.env.MOBILE_MIN_VERSION_ANDROID || '0.0.0',
      'taskbuddy-ios': process.env.MOBILE_MIN_VERSION_IOS || '0.0.0',
    } as Record<string, string>,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'taskbuddy-uploads',
    publicUrl: process.env.R2_PUBLIC_URL || '',
    // Private bucket for child evidence photos - never public, served only via short-lived
    // presigned GET URLs to authenticated, family-scoped requests (F-4).
    evidenceBucket: process.env.R2_EVIDENCE_BUCKET || 'taskbuddy-evidence',
  },
} as const;

// Validate required config
export function validateConfig(): void {
  if (config.env === 'test') return;

  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'ADMIN_INVITE_CODE'];
  // No Redis at launch (single instance); the Redis URL is optional and defaults to localhost.

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // HS256 security rests entirely on secret entropy. Refuse to boot on a short/weak signing key
  // rather than run with tokens an attacker could feasibly brute-force.
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const bytes = Buffer.byteLength(process.env[key] || '', 'utf8');
    if (bytes < 32) {
      throw new Error(`${key} must be at least 32 bytes (got ${bytes}) for HS256 signing security`);
    }
  }
}

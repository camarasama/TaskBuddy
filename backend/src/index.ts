import './instrument';
import express from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { config, validateConfig } from './config';
import { prisma } from './services/database';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { apiRouter } from './routes';
import { initScheduler } from './services/scheduler';
// M8 - Admin router mounted at /api/v1/admin
import { adminRouter } from './routes/admin';
import { adminGamesRouter } from './routes/adminGames';
import { templatesRouter } from './routes/templates';
import { trackRouter } from './routes/track';
import { consentRouter } from './routes/consent';
import { initRecurringScheduler } from './services/RecurringScheduler';
import { startExpiryEmailCron } from './jobs/expiryEmailCron';
import { startStreakAtRiskCron } from './jobs/streakAtRiskCron';
import { startDigestCron } from './jobs/digestCron';
import { startDailyChallengeCron } from './jobs/dailyChallengeCron';
// M10 - Phase 4/5: Reports, Notifications and real-time socket
import { reportsRouter } from './routes/reports';
import { notificationsRouter } from './routes/notifications';
// FR-18 - Outbound webhooks (parent-managed, family-scoped)
import { webhooksRouter } from './routes/webhooks';
import { initSocketService } from './services/SocketService';
import { seedGames } from './routes/gamesSeed';
import { seedSystemTemplates } from './routes/templatesSeed';

// Validate environment configuration
validateConfig();

// Create Express app
const app = express();
// Behind nginx (production): trust the first proxy hop so req.ip / X-Forwarded-For
// and req.protocol are the real client values, not the proxy's. Required for
// express-rate-limit to key on the actual client IP rather than 127.0.0.1.
if (config.env === 'production') {
  app.set('trust proxy', 1);
}
const httpServer = createServer(app);

// Explicitly allowlisted ngrok URLs (comma-separated ALLOWED_NGROK_URL env var)
const allowedNgrokUrls = (process.env.ALLOWED_NGROK_URL || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

// M10 - Phase 5: Socket.io server - attached to same HTTP server so it shares the port
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.env !== 'production' && allowedNgrokUrls.includes(origin)) return callback(null, true);
      if ((process.env.CLIENT_URL || 'http://localhost:3000')
          .split(',').map((o) => o.trim()).includes(origin || '')) {
        return callback(null, true);
      }
      callback(new Error(`Socket CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  },
});

// Build list of allowed CORS origins from CLIENT_URL (supports comma-separated list)
const allowedOrigins: string[] = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Rate limiters
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } },
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow any ngrok tunnel URL automatically in non-production environments
      if (config.env !== 'production' && allowedNgrokUrls.includes(origin)) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  })
);

// Request parsing
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(cookieParser());

// Logging
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// Serve uploaded files - no auth required (paths use random UUIDs, not guessable)
app.get('/uploads/*', (req: express.Request, res: express.Response) => {
  const uploadBase = path.resolve(__dirname, '../uploads');
  const filePath = path.resolve(uploadBase, (req.params as any)[0]);
  // Path traversal guard
  if (!filePath.startsWith(uploadBase + path.sep) && filePath !== uploadBase) {
    return res.status(400).end();
  }
  res.sendFile(filePath);
});

// Health check - readiness probe: verifies the DB is reachable (used by UptimeRobot + Railway)
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

// Global and auth-specific rate limiters
app.use('/api/v1', globalLimiter);
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/child/login', authLimiter);
app.use('/api/v1/auth/admin/register', authLimiter);

// API routes
app.use('/api/v1', apiRouter);
// M8 - Admin API routes (role-protected inside the router itself)
// Games CRUD mounts FIRST: adminRouter has no /games routes, but mounting the more specific path
// ahead of it keeps this independent of any future wildcard there.
app.use('/api/v1/admin/games', adminGamesRouter);
app.use('/api/v1/admin', adminRouter);
// M10 - Phase 4: Reports (parent + admin) and in-app notifications
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/notifications', notificationsRouter);
// Growth roadmap §3.1 - task template library + reward presets (parent-only)
app.use('/api/v1/templates', templatesRouter);
// Growth roadmap §1 - digest open tracking. PUBLIC (email clients cannot auth); HMAC-signed URLs.
app.use('/api/v1/track', trackRouter);
// Growth roadmap §3.2 - COPPA verifiable parental consent. /verify is public (emailed link).
app.use('/api/v1/consent', consentRouter);
// FR-18 - Outbound webhooks (parent-only, enforced inside the router)
app.use('/api/v1/webhooks', webhooksRouter);

// Error handling
app.use(notFoundHandler);
Sentry.setupExpressErrorHandler(app); // captures errors, then delegates to errorHandler
app.use(errorHandler);

// Start server
const PORT = config.port;

// Graceful shutdown: stop accepting new connections, close socket.io, disconnect Prisma.
// Intervals from the schedulers/crons die with the process on exit.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received - shutting down gracefully...`);

  // Force-exit if the graceful close hangs (e.g. a stuck keep-alive connection).
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out after 10s - forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  httpServer.close(async () => {
    try {
      io.close();
      await prisma.$disconnect();
      console.log('Cleanup complete - exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown cleanup:', err);
      process.exit(1);
    }
  });
}

// Only boot the server + background work outside of tests (tests import `app` directly).
if (config.env !== 'test') {
  initScheduler();
  initRecurringScheduler(); // M8 - midnight recurring task generation
  startExpiryEmailCron();
  startStreakAtRiskCron();
  startDailyChallengeCron();
  startDigestCron(); // growth roadmap §3.3 - Monday 07:00 UTC weekly parent digest
  initSocketService(io); // M10 - Phase 5: wire socket emit helper

  seedGames().catch(console.error);
  // Growth roadmap §3.1 - idempotent by (category, name); never overwrites an edit.
  seedSystemTemplates().catch(console.error);

  httpServer.listen(PORT, () => {
    console.log(`
🚀 TaskBuddy API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 Environment: ${config.env}
📡 Server:      http://localhost:${PORT}
📚 API:         http://localhost:${PORT}/api/v1
❤️  Health:      http://localhost:${PORT}/health
🔔 Socket.io:   ws://localhost:${PORT}
🔓 CORS:        ${allowedOrigins.join(', ')} ${config.env !== 'production' ? '+ ngrok tunnels' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export { app, httpServer };
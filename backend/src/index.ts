import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config, validateConfig } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { initScheduler } from './services/scheduler';
// M8 — Admin router mounted at /api/v1/admin
import { adminRouter } from './routes/admin';
import { initRecurringScheduler } from './services/RecurringScheduler';
import { startExpiryEmailCron } from './jobs/expiryEmailCron';
import { startStreakAtRiskCron } from './jobs/streakAtRiskCron';
// M10 — Phase 4/5: Reports, Notifications and real-time socket
import { reportsRouter } from './routes/reports';
import { notificationsRouter } from './routes/notifications';
import { initSocketService } from './services/SocketService';

// Validate environment configuration
validateConfig();

// Create Express app
const app = express();
const httpServer = createServer(app);

// M10 — Phase 5: Socket.io server — attached to same HTTP server so it shares the port
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isNgrok =
        /^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/.test(origin) ||
        /^https:\/\/[a-z0-9-]+\.ngrok\.io$/.test(origin);
      if (config.env !== 'production' && isNgrok) return callback(null, true);
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

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow any ngrok tunnel URL automatically in non-production environments
      const isNgrok = /^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/.test(origin) ||
                      /^https:\/\/[a-z0-9-]+\.ngrok\.io$/.test(origin);

      if (config.env !== 'production' && isNgrok) {
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// Serve uploaded files
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1', apiRouter);
// M8 — Admin API routes (role-protected inside the router itself)
app.use('/api/v1/admin', adminRouter);
// M10 — Phase 4: Reports (parent + admin) and in-app notifications
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/notifications', notificationsRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = config.port;

initScheduler();
initRecurringScheduler(); // M8 — midnight recurring task generation
startExpiryEmailCron();
startStreakAtRiskCron();
initSocketService(io); // M10 — Phase 5: wire socket emit helper

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

export { app, httpServer };
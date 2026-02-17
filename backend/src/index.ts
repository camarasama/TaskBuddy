import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer } from 'http';

import { config, validateConfig } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

// Validate environment configuration
validateConfig();

// Create Express app
const app = express();
const httpServer = createServer(app);

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

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = config.port;

httpServer.listen(PORT, () => {
  console.log(`
🚀 TaskBuddy API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 Environment: ${config.env}
📡 Server:      http://localhost:${PORT}
📚 API:         http://localhost:${PORT}/api/v1
❤️  Health:      http://localhost:${PORT}/health
🔓 CORS:        ${allowedOrigins.join(', ')} ${config.env !== 'production' ? '+ ngrok tunnels' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

export { app, httpServer };
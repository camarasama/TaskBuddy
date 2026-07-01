import * as Sentry from '@sentry/node';

// DSN-guarded: when SENTRY_DSN is unset, Sentry is never initialized (no-op, no events).
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Errors only by default; enable/adjust performance tracing via env when desired.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
}

import * as Sentry from '@sentry/nextjs';

// Client-side (browser) Sentry init. DSN-guarded: when NEXT_PUBLIC_SENTRY_DSN is
// unset, Sentry is never initialized (no-op, no events, no network).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // Errors only by default; adjust via env when performance tracing is wanted.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  });
}

// Instruments App Router client-side navigations for Sentry.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

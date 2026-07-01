import * as Sentry from '@sentry/nextjs';

// Server-side (Node + Edge runtimes) Sentry init. DSN-guarded: when
// NEXT_PUBLIC_SENTRY_DSN is unset, Sentry is never initialized (no-op, no events).
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Errors only by default; adjust via env when performance tracing is wanted.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  });
}

// Next.js server error hook -> forwards nested React Server Component errors to Sentry.
export const onRequestError = Sentry.captureRequestError;

/**
 * Error reporting seam (§3.5).
 *
 * Sentry lives behind this seam rather than being called directly from screens. That was the point of
 * building the seam first: the app grew twenty-odd call sites of `reportError` while running in Expo
 * Go, where `@sentry/react-native` — a **native** module with a config plugin — could not run at all.
 * Wiring it up afterwards therefore touched this file, the config, and nothing else.
 *
 * The ring buffer below is kept. It is not redundant with Sentry: it backs the diagnostics screen, it
 * works with no DSN and no network, and a tester reading you the last error beats waiting for it to
 * surface in a dashboard.
 */
import * as Sentry from '@sentry/react-native';

import { CLIENT_VERSION, SENTRY_DSN } from './config';

/**
 * Ring buffer of what has gone wrong this session, newest last.
 *
 * Exists because until Sentry is live, `console.warn` on a phone means "attach a laptop and run
 * `adb logcat`". Keeping the last few in memory lets the diagnostics screen show them, which is the
 * difference between a tester saying "it broke" and a tester reading you the reason.
 */
const MAX_RECENT = 20;

export interface ReportedError {
  at: Date;
  message: string;
  /** Where it came from — a screen name, a subsystem. Free text, for grouping by eye. */
  context?: string;
}

const recent: ReportedError[] = [];

export function recentErrors(): readonly ReportedError[] {
  return recent;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Record a handled error.
 *
 * For failures the app has already dealt with but that someone should still know happened — a refresh
 * that could not persist, a keystore that would not open. Deliberately never throws: a reporting path
 * that can fail is a reporting path that takes the app down with it.
 */
export function reportError(error: unknown, context?: string): void {
  try {
    const entry: ReportedError = { at: new Date(), message: describe(error), context };
    recent.push(entry);
    if (recent.length > MAX_RECENT) recent.shift();

    /**
     * Skipped under test: several suites deliberately break the keystore or the network to assert the
     * handling, and warning on each one buries genuine failures in CI output. The ring buffer above is
     * what tests assert against, so nothing is lost.
     */
    if (__DEV__ && process.env.NODE_ENV !== 'test') {
      console.warn(`[report]${context ? ` ${context}:` : ''}`, error);
    }

    /**
     * Idempotent, and called here rather than relying on the root layout having run.
     *
     * `initReporting()` fires from an effect in `app/_layout.tsx`, which means it has NOT run during
     * the first render — exactly when a render crash would reach the root `ErrorBoundary`. Initialising
     * lazily on the first report closes that window, and the guard makes the repeat calls free.
     */
    initReporting();
    Sentry.captureException(error, context ? { tags: { context } } : undefined);
  } catch {
    /* reporting must never be the reason something breaks */
  }
}

let initialized = false;

/**
 * Initialise Sentry. Called from the root layout before any screen mounts, and again — harmlessly —
 * from the first `reportError`.
 *
 * DSN-guarded: with `EXPO_PUBLIC_SENTRY_DSN` unset there is no init, no events and no network, which
 * is how local development and anyone building a fork stay out of our project. Same contract as
 * `backend/src/instrument.ts`.
 */
export function initReporting(): void {
  // Latched before the DSN check so a build without one does not re-enter on every single report.
  if (initialized) return;
  initialized = true;

  if (!SENTRY_DSN) return;

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: __DEV__ ? 'development' : 'production',
      release: CLIENT_VERSION,
      // Errors only. Performance tracing on a children's app buys little and costs battery and quota.
      tracesSampleRate: 0,
      /**
       * Explicit, and load-bearing for compliance rather than merely tidy. This app is used by
       * children, so Google Play's Families policy applies; `sendDefaultPii` would attach IP
       * addresses and usernames to every event. It defaults to false — stated anyway so that nobody
       * flips it on later without reading this.
       */
      sendDefaultPii: false,
    });
  } catch {
    /* An unusable reporter must not be the reason the app fails to start. */
  }
}

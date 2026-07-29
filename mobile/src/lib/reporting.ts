/**
 * Error reporting seam (§3.5).
 *
 * ## Why this is not Sentry yet
 *
 * The roadmap says to wire Sentry before building screens, so early crashes are visible. That intent
 * is right, but `@sentry/react-native` is a **native** module with a config plugin: it needs a
 * development build to work at all, and Expo Go — which is what the app currently runs in — ships a
 * fixed set of native modules that does not include it. Adding it now would risk the exact failure
 * that cost Phase 0 four debugging rounds (a native module the Expo Go binary does not contain,
 * presenting as the app vanishing with no error anywhere), and it could not be verified until the
 * development build exists.
 *
 * So the *seam* goes in now and the backend behind it changes later. Screens and the error boundary
 * call `reportError`; swapping the console sink for `Sentry.captureException` is a change to this file
 * and nothing else. That keeps the roadmap's real goal — crash reporting designed in from the start
 * rather than retrofitted through twenty screens — without betting the app on an unverifiable
 * dependency.
 *
 * When the development build lands: add `@sentry/react-native` as a *direct* dependency, init it in
 * `initReporting()` guarded on a DSN (the same DSN-guarded pattern the web and backend already use, so
 * an unset DSN means no init, no events, no network), and forward from `reportError`.
 */

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
     * Replaced by `Sentry.captureException` once the development build exists.
     *
     * Skipped under test: several suites deliberately break the keystore or the network to assert the
     * handling, and warning on each one buries genuine failures in CI output. The ring buffer above is
     * what tests assert against, so nothing is lost.
     */
    if (__DEV__ && process.env.NODE_ENV !== 'test') {
      console.warn(`[report]${context ? ` ${context}:` : ''}`, error);
    }
  } catch {
    /* reporting must never be the reason something breaks */
  }
}

/**
 * Called once from the root layout. A no-op today; the place Sentry's `init` goes.
 *
 * Kept even while empty so the call site exists and is already in the right place — the root layout,
 * before any screen mounts.
 */
export function initReporting(): void {
  // Intentionally empty. See the note at the top of this file.
}

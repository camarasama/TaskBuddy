'use client';

/**
 * Root error boundary for the App Router.
 *
 * ## Why this file exists
 *
 * Sentry's browser SDK hooks `window.onerror`, which catches errors thrown from event handlers and
 * async callbacks — the `/child/tasks` tab crash arrived that way. It does **not** catch errors thrown
 * during React *rendering*: React swallows those into the nearest error boundary, and with no boundary
 * present the App Router replaces the tree with its own generic screen and nothing is reported.
 *
 * So the whole class of "the page went blank" bugs was invisible. This boundary closes that, and the
 * Sentry build plugin warns about its absence on every build for exactly this reason.
 *
 * `global-error.tsx` is the outermost boundary — it replaces the root layout when it fires, which is
 * why it must render its own `<html>` and `<body>`. It only catches what nested boundaries do not, so
 * a per-route `error.tsx` added later still takes precedence.
 *
 * ## Deliberate: the report happens in an effect
 *
 * Not in the render body. A boundary can re-render (a theme change, a parent update, the user tapping
 * "try again"), and a render-phase side effect would file the same crash again on each pass. Keying
 * the effect on `error` reports each distinct failure exactly once — the same reasoning as the mobile
 * app's `ErrorBoundary` in `mobile/app/_layout.tsx`.
 *
 * ## Deliberate: the message says nothing about the error
 *
 * `error.message` can carry anything the throwing code put in it. This app is used by children and by
 * parents whose data is in play, so the screen stays generic and the detail goes to Sentry. `digest`
 * is the exception: it is a server-generated opaque id, safe to show, and it is the one thing that
 * lets a support conversation find the matching event.
 */
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

import { componentStackOf } from '@/lib/componentStack';

/**
 * Send the crash, plus the component stack if `ReactErrorReporter` managed to capture one.
 *
 * The stack goes in two slots because they answer different questions and only one of them is
 * readable in production:
 *
 *  - `contexts.react.componentStack` is the raw text, the convention every Sentry React app uses.
 *    Function component names are minified in a production build, but host elements are not, so even
 *    the raw form gives the DOM shape around the failure.
 *  - `threads` carries the same frames parsed, which is what makes Sentry resolve them against the
 *    uploaded source maps and print real file names and line numbers. It goes in `threads` and NOT
 *    in `exception.values` on purpose: Sentry groups on the exception chain, so adding a value there
 *    would split one crash into a new issue on the deploy that added this, losing its history.
 */
function report(error: Error) {
  const componentStack = componentStackOf(error);

  if (!componentStack) {
    Sentry.captureException(error);
    return;
  }

  Sentry.withScope((scope) => {
    scope.setContext('react', { componentStack });

    scope.addEventProcessor((event) => {
      // React formats component frames exactly like V8 stack frames, so the browser stack parser
      // reads them without help. A parse that yields nothing simply leaves the context text.
      const frames = Sentry.defaultStackParser(componentStack);
      if (frames.length > 0) {
        event.threads = {
          values: [
            {
              // Not a real thread; the browser has one. This is the slot Sentry symbolicates that
              // does not participate in grouping.
              id: 0,
              name: 'React component stack',
              crashed: false,
              current: false,
              stacktrace: { frames },
            },
          ],
        };
      }
      return event;
    });

    Sentry.captureException(error);
  });
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    report(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.5, color: '#475569', margin: '0 0 1.5rem' }}>
            Sorry — that page didn&apos;t load properly. We&apos;ve been told about it. Try again, and
            if it keeps happening let us know.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '44px',
              padding: '0 1.5rem',
              border: 'none',
              borderRadius: '0.5rem',
              background: '#2b7f91', // brand teal (primary-500), hardcoded: this screen renders without the token pipeline
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {/*
            Opaque and server-generated — safe to display, and the only handle a support conversation
            has for finding the matching Sentry event.
          */}
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '1.5rem' }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

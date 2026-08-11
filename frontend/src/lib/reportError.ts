'use client';

/**
 * The one place a client-side React failure is sent to Sentry.
 *
 * Shared by `global-error.tsx` (the crash the user saw) and `ReactErrorReporter` (the crash it
 * recovered from) so both reports carry the same detail. Without that, the recovered ones — which
 * are now the common case — would arrive with less information than the fatal ones.
 */
import * as Sentry from '@sentry/nextjs';

import { componentStackOf } from '@/lib/componentStack';

/**
 * Send a React error, plus the component stack if `ReactErrorReporter` captured one.
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
 *
 * `recovered` separates "the page died" from "the page carried on", which are very different bugs
 * with the same stack.
 */
export function reportReactError(error: Error, { recovered = false }: { recovered?: boolean } = {}) {
  const componentStack = componentStackOf(error);

  Sentry.withScope((scope) => {
    scope.setTag('react.recovered', recovered ? 'yes' : 'no');

    if (componentStack) {
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
    }

    Sentry.captureException(error);
  });
}

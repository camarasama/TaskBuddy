'use client';

/**
 * Catches React errors, records the component stack React only gives to a class boundary, and — for
 * the class of failure that does not actually break the page — puts the page back.
 *
 * ## The failure this exists for
 *
 * `TypeError: i is not a function`, thrown from `commitHookEffectListUnmount`: an effect's cleanup
 * slot held something that was not a function, and React hit it while tearing down a tree that was
 * already being discarded. Opening a task and pressing back was enough to trigger it, for parents
 * and children alike, and it took the whole page down with a "Something went wrong" screen.
 *
 * The tree that failed was on its way out. Nothing the user was looking at was broken — React
 * escalates a commit-phase error to the nearest boundary, and the boundary is what destroyed the
 * page. That escalation is right for a render error and wrong for this.
 *
 * ## How the two are told apart, without guessing
 *
 * By trying. A cleanup error in a discarded tree does not recur: rendering the children again
 * succeeds and the app carries on. A genuine render error throws again on the very next render, and
 * then this boundary rethrows and `global-error.tsx` shows exactly the screen it always did.
 *
 * So the rule is: recover once, and if the failure comes straight back, stop recovering. The
 * counter resets after a quiet second, so an unrelated failure much later still gets its own
 * attempt rather than inheriting an old budget.
 *
 * ⚠️ This is a mitigation and not a fix. The bad cleanup value is still being produced; it is now
 * reported (tagged `react.recovered=yes`) instead of being shown to a child as a broken page. The
 * report carries the component stack, which is what the root cause is still missing.
 *
 * ## Deliberate: rethrow rather than render a fallback
 *
 * An error screen here would put "Something went wrong" in two files and let them drift.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { rememberComponentStack } from '@/lib/componentStack';
import { reportReactError } from '@/lib/reportError';

/** Attempts allowed in one burst before the error is treated as fatal and escalated. */
const MAX_CONSECUTIVE_RECOVERIES = 2;

/** Quiet period after which a recovery is considered to have held, and the budget is refilled. */
const RECOVERY_RESET_MS = 1000;

interface Props {
  children: ReactNode;
}

interface State {
  /** Non-null only for the render in which the error is escalated upward. */
  error: Error | null;
}

export class ReactErrorReporter extends Component<Props, State> {
  state: State = { error: null };

  private consecutive = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    rememberComponentStack(error, errorInfo.componentStack);

    if (this.consecutive >= MAX_CONSECUTIVE_RECOVERIES) {
      // Out of attempts: leave `error` set so render throws and the boundary above takes over. The
      // report for this one is filed by `global-error.tsx`, so it is not sent twice.
      return;
    }

    this.consecutive += 1;
    reportReactError(error, { recovered: true });

    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.consecutive = 0;
    }, RECOVERY_RESET_MS);

    // Clearing the error in the same error-handling pass is what makes the retry happen: React
    // applies this before re-rendering, so `render` returns the children instead of throwing.
    this.setState({ error: null });
  }

  componentWillUnmount() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  render() {
    if (this.state.error) throw this.state.error;
    return this.props.children;
  }
}

'use client';

/**
 * A boundary that catches nothing and reports nothing — it exists purely to capture React's
 * component stack on the way past.
 *
 * `componentDidCatch(error, errorInfo)` is the only place React hands over `errorInfo.componentStack`,
 * and it is only called on class components. Next's App Router boundary owns the catching and passes
 * the error alone to `global-error.tsx`, so that stack was being discarded. This sits below it,
 * records the stack against the error, then rethrows so the error carries on to exactly the same
 * place it went before.
 *
 * ## Deliberate: rethrow rather than render a fallback
 *
 * Rendering its own error screen here would move the "Something went wrong" UI out of
 * `global-error.tsx` and into two places. Throwing from `render` sends the error to the next boundary
 * *above* this one — React never lets a boundary catch its own render error — so the user sees the
 * identical screen, the reset button still belongs to the same component, and nothing about the
 * app's behaviour changes. The only difference is that the report now knows which components were
 * rendering when it happened.
 *
 * There is no loop to worry about: the boundary above replaces the whole root layout, which unmounts
 * this component along with the tree it was watching.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { rememberComponentStack } from '@/lib/componentStack';

interface Props {
  children: ReactNode;
}

interface State {
  /** Non-null only for the single render between catching and rethrowing. */
  error: Error | null;
}

export class ReactErrorReporter extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    rememberComponentStack(error, errorInfo.componentStack);
  }

  render() {
    if (this.state.error) throw this.state.error;
    return this.props.children;
  }
}

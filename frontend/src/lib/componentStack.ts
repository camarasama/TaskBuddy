/**
 * Carries React's component stack from the boundary that has it to the boundary that reports it.
 *
 * ## Why this exists
 *
 * A React error tells you *what* broke and almost never *where*. The `/child/tasks` crash arrived in
 * Sentry as `TypeError: i is not a function` with a stack made entirely of React reconciler frames —
 * `commitHookEffectListUnmount` calling an effect cleanup that was not a function. Every frame was
 * inside React, so nothing in it named the component whose effect it was, and no amount of reading
 * that trace could narrow it below "some component in the tree being unmounted".
 *
 * The component stack is the missing half, and React only ever hands it to a class boundary's
 * `componentDidCatch`. `global-error.tsx` is a function component receiving `{ error }` — Next's own
 * boundary caught it and passed on the error alone. So the information existed and was thrown away
 * one component above the code that reports to Sentry.
 *
 * ## Why a WeakMap rather than a property on the error
 *
 * The error object travels: it is passed to Next's boundary, may be logged, and for server errors is
 * serialised into a `digest`. Hanging a property on it puts diagnostic text somewhere it could be
 * shown to a user or persisted. A WeakMap keyed on the error keeps the association exactly as long
 * as the error is alive and nowhere else.
 */

/** Keyed on the thrown value itself, so nothing is retained after the error is collected. */
const stacks = new WeakMap<object, string>();

/** Called from the boundary that has `errorInfo`. Non-object throws (a string, null) are ignored. */
export function rememberComponentStack(error: unknown, componentStack: string | null | undefined) {
  if (typeof error !== 'object' || error === null) return;
  if (!componentStack) return;
  stacks.set(error, componentStack);
}

/** Called from the boundary that reports. Returns undefined when the error never passed a boundary. */
export function componentStackOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return stacks.get(error);
}

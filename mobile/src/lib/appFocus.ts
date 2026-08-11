/**
 * What "focused" means to React Query on a phone.
 *
 * ⚠️ `refetchOnWindowFocus` defaults to true and does NOTHING in React Native. It listens for a
 * browser `window` focus event that never fires here, so without wiring the only refetch trigger is
 * a query mounting. Data therefore goes stale the moment the app is backgrounded and stays stale
 * until the screen is remounted.
 *
 * That is not theoretical. A parent returned a submitted task and the child's app kept showing it as
 * submitted; the only way to see the change was to sign out and back in, which remounts everything.
 * The mobile app has **no socket client** — realtime events are web-only — so refetch-on-foreground
 * is the entire mechanism by which a child learns a parent did something.
 *
 * Extracted from `_layout.tsx` so the mapping can be tested. The bug it fixes was invisible
 * precisely because nothing observable failed.
 */
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Only `active` counts as focused.
 *
 * `inactive` is the iOS transitional state — the app switcher, an incoming call, the notification
 * shade. Treating it as unfocused and then refocusing on the way back produces a refetch every time
 * someone swipes between apps, which on a metered connection is a real cost for no new information.
 */
export function isFocused(status: AppStateStatus): boolean {
  return status === 'active';
}

/** Subscribe React Query's focus manager to AppState. Returns the unsubscribe function it expects. */
export function subscribeAppFocus(handleFocus: (focused: boolean) => void): () => void {
  const subscription = AppState.addEventListener('change', (status) => {
    handleFocus(isFocused(status));
  });
  return () => subscription.remove();
}

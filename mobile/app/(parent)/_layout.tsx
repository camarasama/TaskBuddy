/**
 * Parent shell.
 *
 * **This layout is the role boundary.** Every screen placed in this directory inherits the check
 * below, which is the whole point of using a route group rather than checking a role inside each
 * screen: a screen added here next month is guarded whether or not anyone remembers to guard it.
 *
 * A child session that reaches any `(parent)` route — by deep link, by a stale history entry, by a
 * mistaken `router.push` — is bounced to `/`, which then redirects it into the child shell. That is
 * the structural guarantee the roadmap asks for. It is worth being precise about what it is not:
 * expo-router still *resolves* these paths, so this is a mount-time refusal, not an unroutable URL.
 * The server's role gates are the actual authority on data; this keeps the UI honest.
 *
 * Navigation is a plain Stack. Tabs would be the natural shape for the parent area, but
 * `@react-navigation/bottom-tabs` is not currently installed, and adding a navigator that drags in an
 * undeclared native module is precisely the failure class that cost Phase 0 four debugging rounds
 * (see the note in `metro.config.js`). It gets declared explicitly when the real screens land.
 */
import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/stores/auth';

export default function ParentLayout() {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  if (status !== 'signedIn' || !user || user.role !== 'parent') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

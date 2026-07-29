/**
 * Child shell.
 *
 * The mirror of `(parent)/_layout.tsx`, and the same reasoning applies: this layout is the role
 * boundary for everything in this directory, so screens added later are guarded by construction.
 *
 * The asymmetry worth noting is that this guard also refuses *parents*. Not for safety — a parent
 * seeing a child screen leaks nothing — but because the child experience is built around one child's
 * own points, streaks and tasks, and a parent session has no such subject. Half the screen would
 * render empty. Parents get the child's view through the children screens in their own shell.
 */
import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/stores/auth';

export default function ChildLayout() {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  if (status !== 'signedIn' || !user || user.role !== 'child') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

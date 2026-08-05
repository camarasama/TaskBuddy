/**
 * Games stack, nested inside the Games tab.
 *
 * Play and review are pushed rather than tabbed: a child mid-quiz should not be able to leave by
 * mis-tapping a tab and lose their answers, and a `Stack` gives them a back affordance that says so.
 * The role guard lives one level up in `(child)/_layout.tsx`, so nothing is re-checked here.
 */
import { Stack } from 'expo-router';

export default function GamesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

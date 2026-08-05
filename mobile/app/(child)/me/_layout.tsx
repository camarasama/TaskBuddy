/**
 * "Me" stack — achievements, leaderboard, recap, cosmetics and sign-out.
 *
 * Four screens behind one tab rather than four tabs. Five is the practical ceiling before labels
 * truncate on a narrow phone, and these four are all reference material a child visits occasionally —
 * unlike Tasks, Rewards and Games, which are the loop. The role guard lives in `(child)/_layout.tsx`.
 */
import { Stack } from 'expo-router';

export default function MeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

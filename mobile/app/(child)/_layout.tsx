/**
 * Child shell — a bottom tab bar.
 *
 * The mirror of `(parent)/_layout.tsx`, and the same reasoning applies: this layout is the role
 * boundary for everything in this directory, so screens added later are guarded by construction rather
 * than by everyone remembering.
 *
 * The asymmetry worth noting is that this guard also refuses *parents*. Not for safety — a parent
 * seeing a child screen leaks nothing — but because the child experience is built around one child's
 * own points, streaks and tasks, and a parent session has no such subject. Half the screen would render
 * empty. Parents get the child's view through the children screens in their own shell.
 *
 * ## On the tab set
 *
 * Only the tabs whose screens exist are declared. expo-router resolves `<Tabs.Screen name="…">`
 * against real files in this directory, so declaring a tab ahead of its screen is a routing error, not
 * a placeholder. Rewards, Games and a "Me" tab (achievements, leaderboard, recap, cosmetics) join as
 * those screens land — five is the ceiling before labels truncate on a narrow phone, which is why the
 * last four collapse into one tab rather than getting one each.
 *
 * Import is `expo-router/js-tabs`, not `expo-router` — the root `Tabs` export is deprecated in SDK 57.
 * `native-tabs` is deliberately unused: it reaches for platform tab views and would reintroduce exactly
 * the native-mismatch risk class that cost Phase 0 four rounds.
 */
// From the family's own module, never the `@expo/vector-icons` barrel — the barrel bundles all 20 icon
// fonts (+400KB) on an app whose audience is families with cheap phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, useTheme } from '@/theme';

export default function ChildLayout() {
  const theme = useTheme();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  if (status !== 'signedIn' || !user || user.role !== 'child') {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
        tabBarLabelStyle: {
          fontSize: fontSize.xs.fontSize,
          fontWeight: fontWeight.medium,
        },
        tabBarItemStyle: { minHeight: minTouchTarget },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color, size }) => <Ionicons name="gift-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="games"
        options={{
          title: 'Games',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="game-controller-outline" size={size} color={color} />
          ),
        }}
      />
      {/*
        Reachable, but not a tab. A child opens a task from a row on Home or Tasks, never from the
        tab bar — and without this expo-router gives every route in the group a default tab, which
        shipped once as a stray "task-detail" tab sitting next to Home. `href: null` is how a route
        stays in the group without one; omitting the <Tabs.Screen> entirely does NOT.
      */}
      <Tabs.Screen name="task-detail" options={{ href: null }} />

      <Tabs.Screen
        name="me"
        /**
         * Pressing "Me" always opens the hub, never the sub-screen the child left open.
         *
         * React Navigation preserves each tab's stack, which is the right default for a tab you
         * *work* in, but the four screens behind Me are reference material reached from the hub, so
         * restoring one means the tab labelled "Me" opens on Notifications until something resets it.
         * That is precisely how this was reported.
         *
         * Deliberately not applied to the Games tab: its stack holds `play`, and a child who checks
         * their points mid-quiz should come back to the quiz.
         */
        listeners={{ tabPress: () => router.navigate('/(child)/me') }}
        options={{
          title: 'Me',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

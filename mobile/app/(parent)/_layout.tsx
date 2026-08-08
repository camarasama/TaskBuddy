/**
 * Parent shell — a bottom tab bar.
 *
 * **This layout is the role boundary.** Every screen in this directory inherits the check below, which
 * is the point of a route group rather than a per-screen role test: a screen added here next month is
 * guarded whether or not anyone remembers to guard it.
 *
 * A child session reaching any `(parent)` route — deep link, stale history, a mistaken `router.push` —
 * is bounced to `/`, which redirects it into the child shell. Worth being precise about what that is
 * not: expo-router still *resolves* these paths, so this is a mount-time refusal rather than an
 * unroutable URL. The server's role gates remain the authority on data; this keeps the UI honest.
 *
 * ## On `Tabs`
 *
 * Earlier steps used a plain `Stack` on the belief that tabs would need `@react-navigation/bottom-tabs`
 * installed, and that pulling in an undeclared native module was the failure class that cost Phase 0
 * four rounds. That was wrong: **expo-router SDK 57 vendors react-navigation inside itself**
 * (`expo-router/build/react-navigation/bottom-tabs`), which is why the package appears in neither its
 * dependencies nor its peers. So the tab bar costs no new native surface at all.
 *
 * The import is `expo-router/js-tabs`, not `expo-router` — the root `Tabs` export is deprecated in this
 * SDK and says so. There is also a `native-tabs` build; deliberately not used, because that one *does*
 * reach for platform tab views and would reintroduce exactly the Expo Go mismatch risk this avoids.
 */
// Imported from the family's own module, not the `@expo/vector-icons` barrel. The barrel pulls in every
// icon family it exports — that is 20 font files in the bundle instead of one, on an app whose audience
// is families with cheap Android phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useQuery } from '@tanstack/react-query';

import { dashboardQuery } from '@/lib/dashboardApi';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, useTheme } from '@/theme';

export default function ParentLayout() {
  const theme = useTheme();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  /**
   * The approvals badge.
   *
   * Reuses the dashboard's query, so React Query serves it from the same cache entry rather than
   * issuing a second request — which also means the badge and the dashboard card can never disagree.
   * `enabled` keeps it from firing while the guard below is still deciding.
   */
  const signedIn = status === 'signedIn' && user?.role === 'parent';
  const { data } = useQuery({ ...dashboardQuery(), enabled: signedIn });
  const waiting = data?.pendingApprovals.length ?? 0;

  if (status !== 'signedIn' || !user || user.role !== 'parent') {
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
        // Five tabs on a narrow phone: without this the labels truncate to nonsense.
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
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-done-outline" size={size} color={color} />
          ),
          // The one number a parent wants without opening anything.
          tabBarBadge: waiting > 0 ? waiting : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.destructive },
        }}
      />
      <Tabs.Screen
        name="children"
        options={{
          title: 'Children',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
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
      {/*
        Reachable, but not a tab. Six labels do not fit a narrow phone, and signed-in devices is a
        screen a parent opens when something has happened rather than daily — it is linked from the
        children screen. `href: null` is how expo-router keeps a route in the group without giving it a
        tab; omitting the <Tabs.Screen> entirely would give it a default one instead.
      */}
      <Tabs.Screen name="devices" options={{ href: null }} />
      <Tabs.Screen name="family-code" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="task-form" options={{ href: null }} />
      <Tabs.Screen name="reward-form" options={{ href: null }} />
      <Tabs.Screen name="child-form" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="co-parents" options={{ href: null }} />
      <Tabs.Screen name="consent" options={{ href: null }} />
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="insights" options={{ href: null }} />
    </Tabs>
  );
}

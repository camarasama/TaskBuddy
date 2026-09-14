/**
 * "Me" hub.
 *
 * A profile masthead, three headline numbers, and the way into the reference screens. The counts shown
 * here come from caches the other tabs have usually already filled, so this screen is normally instant.
 *
 * Sign-out lives here rather than on the dashboard: the home tab is for what a child came to do, and a
 * destructive-ish control sitting under their points balance is an odd place for it.
 *
 * ## Colour
 *
 * Each tile carries the accent its subject owns everywhere else in the app: gold for achievements and
 * points, purple for the leaderboard, green for the week, peach for the look and for streaks, teal for
 * notifications. A child arriving from the dashboard finds the same colour attached to the same idea.
 *
 * The hub used to be a column of white cards, each ending in a grey "See all" button, which made every
 * card look like it held two actions. Each entry is one tappable tile now; see `NavTile`.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { GradientHeader } from '@/components/GradientHeader';
import { NavTile } from '@/components/NavTile';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { achievementsQuery } from '@/lib/childProfileApi';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { useAuth } from '@/stores/auth';
import { spacing } from '@/theme';

export default function MeHub() {
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  const dashboard = useQuery(childDashboardQuery());
  const achievements = useQuery(achievementsQuery());
  // Shares the cache entry the NotificationWatcher already polls, so the badge here costs no extra
  // request and can never disagree with the toast that announced the arrival.
  const unreadQuery = useQuery(unreadCountQuery());

  const profile = dashboard.data?.profile;
  const stats = achievements.data?.stats;
  const unread = unreadQuery.data?.count ?? 0;
  const name = user?.firstName ?? 'Me';

  return (
    <Screen>
      <ScrollView>
        <GradientHeader
          tone="brand"
          eyebrow="Me"
          title={`${profile?.avatarEmoji ? `${profile.avatarEmoji} ` : ''}${name}`}
          subtitle={profile ? `Level ${profile.level}` : 'Loading your profile…'}
          badge={<Avatar seed={user?.id ?? 'child'} name={name} size={52} />}
        />

        {profile && (
          <View style={styles.stats}>
            <StatTile value={profile.pointsBalance} label="Points" variant="gold" />
            <StatTile value={profile.totalTasksCompleted} label="Tasks done" variant="success" />
            {/* A bare number with a short caption: three tiles across leave no room for "6 days". */}
            <StatTile value={profile.longestStreakDays} label="Best streak" variant="peach" />
          </View>
        )}

        <NavTile
          title="Notifications"
          icon={unread > 0 ? 'notifications' : 'notifications-outline'}
          tone="primary"
          subtitle={unread > 0 ? plural(unread, 'unread message') : 'Nothing new.'}
          badge={unread > 0 ? `${unread} new` : undefined}
          onPress={() => router.push('/(child)/me/notifications')}
        />
        <NavTile
          title="Achievements"
          icon="trophy"
          tone="gold"
          subtitle={stats ? `${stats.unlocked} of ${stats.total} unlocked` : 'Loading…'}
          onPress={() => router.push('/(child)/me/achievements')}
        />
        <NavTile
          title="Family leaderboard"
          icon="podium"
          tone="xp"
          subtitle="See this week's scores"
          onPress={() => router.push('/(child)/me/leaderboard')}
        />
        <NavTile
          title="Your week"
          icon="calendar"
          tone="success"
          subtitle="What you did this week"
          onPress={() => router.push('/(child)/me/recap')}
        />
        <NavTile
          title="Look"
          icon="shirt"
          tone="peach"
          subtitle="Spend points on things to wear."
          onPress={() => router.push('/(child)/me/cosmetics')}
        />

        <View style={styles.signOut}>
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  signOut: { marginTop: spacing[3], marginBottom: spacing[6] },
});

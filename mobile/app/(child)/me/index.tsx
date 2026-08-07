/**
 * "Me" hub.
 *
 * A short profile summary and the way into the four reference screens. The counts shown here come from
 * caches the other tabs have usually already filled, so this screen is normally instant.
 *
 * Sign-out lives here rather than on the dashboard: the home tab is for what a child came to do, and a
 * destructive-ish control sitting under their points balance is an odd place for it.
 *
 * ## Colour
 *
 * Each card's icon carries the accent its subject owns elsewhere in the app — gold for achievements,
 * xp-purple for the leaderboard, peach for cosmetics — so a child arriving from the dashboard finds
 * the same colour attached to the same idea. Everything else on the screen stays on `useTheme()`.
 * `peach[600]`, not the logo's `peach[400]`: 400 is a decorative fill and disappears against a white
 * card, and this glyph has to be visible on both card colours.
 */
// The family module, never the barrel — see the note in `(child)/_layout.tsx`.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CardHeading } from '@/components/CardHeading';
import { Screen } from '@/components/Screen';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { achievementsQuery } from '@/lib/childProfileApi';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, palette, spacing, useTheme } from '@/theme';

export default function MeHub() {
  const theme = useTheme();
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

  return (
    <Screen>
      <ScrollView>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {profile?.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
          {user?.firstName ?? 'Me'}
        </AppText>

        {/* The identity card. No heading of its own — the name above is its heading — so the icon
            leads the row instead of a label, and the teal border ties it to the points card on the
            home tab. */}
        <Card style={{ borderColor: theme.primary }}>
          <View style={styles.identity}>
            <Ionicons
              name="person-circle"
              size={32}
              color={theme.primary}
              importantForAccessibility="no"
              accessibilityElementsHidden
            />
            <View style={styles.identityText}>
              <AppText style={[styles.body, { color: theme.cardForeground }]}>
                {profile
                  ? `Level ${profile.level} · ${plural(profile.pointsBalance, 'point')} · ${plural(profile.totalTasksCompleted, 'task')} done`
                  : 'Loading your profile…'}
              </AppText>
              {profile && profile.longestStreakDays > 0 && (
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                  Best streak: {plural(profile.longestStreakDays, 'day')}
                </AppText>
              )}
            </View>
          </View>
        </Card>

        <Card style={unread > 0 ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
          <CardHeading
            icon={unread > 0 ? 'notifications' : 'notifications-outline'}
            label="Notifications"
            tint={unread > 0 ? theme.primary : undefined}
          />
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {unread > 0 ? plural(unread, 'unread message') : 'Nothing new.'}
          </AppText>
          <View style={styles.action}>
            <Button
              label={unread > 0 ? `See ${unread}` : 'See all'}
              variant={unread > 0 ? 'primary' : 'secondary'}
              onPress={() => router.push('/(child)/me/notifications')}
            />
          </View>
        </Card>

        <Card>
          <CardHeading icon="trophy" label="Achievements" tint={palette.gold[600]} />
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {stats ? `${stats.unlocked} of ${stats.total} unlocked` : 'Loading…'}
          </AppText>
          <View style={styles.action}>
            <Button
              label="See all"
              variant="secondary"
              onPress={() => router.push('/(child)/me/achievements')}
            />
          </View>
        </Card>

        <Card>
          <CardHeading icon="podium" label="Family leaderboard" tint={palette.xp[600]} />
          <View style={styles.action}>
            <Button
              label="See the scores"
              variant="secondary"
              onPress={() => router.push('/(child)/me/leaderboard')}
            />
          </View>
        </Card>

        <Card>
          <CardHeading icon="calendar" label="Your week" tint={palette.success[600]} />
          <View style={styles.action}>
            <Button
              label="See this week"
              variant="secondary"
              onPress={() => router.push('/(child)/me/recap')}
            />
          </View>
        </Card>

        <Card>
          <CardHeading icon="shirt" label="Look" tint={palette.peach[600]} />
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            Spend points on things to wear.
          </AppText>
          <View style={styles.action}>
            <Button
              label="Change your look"
              variant="secondary"
              onPress={() => router.push('/(child)/me/cosmetics')}
            />
          </View>
        </Card>

        <View style={styles.signOut}>
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  identityText: { flex: 1 },
  action: { marginTop: spacing[3] },
  signOut: { marginTop: spacing[5], marginBottom: spacing[6] },
});

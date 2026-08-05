/**
 * "Me" hub.
 *
 * A short profile summary and the way into the four reference screens. The counts shown here come from
 * caches the other tabs have usually already filled, so this screen is normally instant.
 *
 * Sign-out lives here rather than on the dashboard: the home tab is for what a child came to do, and a
 * destructive-ish control sitting under their points balance is an odd place for it.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { achievementsQuery } from '@/lib/childProfileApi';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

export default function MeHub() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  const dashboard = useQuery(childDashboardQuery());
  const achievements = useQuery(achievementsQuery());

  const profile = dashboard.data?.profile;
  const stats = achievements.data?.stats;

  return (
    <Screen>
      <ScrollView>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {profile?.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
          {user?.firstName ?? 'Me'}
        </AppText>

        <Card>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {profile
              ? `Level ${profile.level} · ${profile.pointsBalance} points · ${profile.totalTasksCompleted} tasks done`
              : 'Loading your profile…'}
          </AppText>
          {profile && profile.longestStreakDays > 0 && (
            <AppText style={[styles.body, { color: theme.mutedForeground }]}>
              Best streak: {profile.longestStreakDays} days
            </AppText>
          )}
        </Card>

        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Achievements</AppText>
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
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            Family leaderboard
          </AppText>
          <View style={styles.action}>
            <Button
              label="See the scores"
              variant="secondary"
              onPress={() => router.push('/(child)/me/leaderboard')}
            />
          </View>
        </Card>

        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Your week</AppText>
          <View style={styles.action}>
            <Button
              label="See this week"
              variant="secondary"
              onPress={() => router.push('/(child)/me/recap')}
            />
          </View>
        </Card>

        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Look</AppText>
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
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  action: { marginTop: spacing[3] },
  signOut: { marginTop: spacing[5], marginBottom: spacing[6] },
});

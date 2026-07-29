/**
 * Child home — a placeholder, mirroring the parent one.
 *
 * Proves the child half of the auth loop and the shell separation. The real child experience is
 * Phase 2; this is only the landing route its guard needs.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

export default function ChildDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  return (
    <Screen scroll>
      <Text style={[styles.greeting, { color: theme.foreground }]}>
        Hi {user?.firstName ?? 'there'}!
      </Text>
      <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
        Your tasks and rewards are on the way.
      </Text>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.mutedForeground }]}>Coming next</Text>
        <Text style={[styles.cardBody, { color: theme.cardForeground }]}>
          Tasks, points, rewards and games arrive in Phase 2.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginTop: spacing[1],
    marginBottom: spacing[6],
  },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing[4] },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  cardBody: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { marginTop: spacing[6] },
});

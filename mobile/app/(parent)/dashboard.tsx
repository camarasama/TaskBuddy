/**
 * Parent home — a placeholder.
 *
 * Exists so the shell has a landing route and the auth loop is demonstrably complete end to end:
 * sign in, land here, restart the app and still be here, sign out and land back at the chooser.
 * The real dashboard (§3.4 screens) replaces the body below; the shell and the guard stay.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

export default function ParentDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  return (
    <Screen scroll>
      <Text style={[styles.greeting, { color: theme.foreground }]}>
        Hello, {user?.firstName ?? 'there'}
      </Text>
      <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>Parent dashboard</Text>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.mutedForeground }]}>Coming next</Text>
        <Text style={[styles.cardBody, { color: theme.cardForeground }]}>
          Tasks, approvals, children and rewards land here next. Signing in, staying signed in across
          restarts, and signing out all work now.
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

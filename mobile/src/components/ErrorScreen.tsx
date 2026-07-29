/**
 * What the user sees when a screen throws during render.
 *
 * Rendered by expo-router's error boundary (see the `ErrorBoundary` export in `app/_layout.tsx`).
 * Without one, a render error in React Native leaves a blank screen and, in a release build, no
 * indication of what happened — which from a tester is reported as "the app stopped working" and
 * costs an afternoon.
 *
 * The message is shown rather than hidden. This is a family app, not a bank: a stack-free error
 * string tells a parent whether to retry or report, and tells us far more than "something went wrong"
 * ever will when it comes back in a message.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

interface ErrorScreenProps {
  error: Error;
  /** Provided by expo-router; re-mounts the failed route. */
  retry: () => void;
}

export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  const theme = useTheme();

  return (
    <Screen scroll center>
      <Text style={[styles.title, { color: theme.foreground }]}>Something broke</Text>
      <Text style={[styles.body, { color: theme.mutedForeground }]}>
        This screen ran into a problem. Trying again usually works; if it keeps happening, the message
        below is the useful part to send us.
      </Text>

      <View style={[styles.detail, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.detailText, { color: theme.cardForeground }]}>
          {error.message || error.name || 'Unknown error'}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Try again" onPress={retry} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  body: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginTop: spacing[2],
    marginBottom: spacing[5],
  },
  detail: { borderWidth: 1, borderRadius: radius.lg, padding: spacing[4] },
  detailText: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { marginTop: spacing[6] },
});

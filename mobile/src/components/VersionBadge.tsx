/**
 * The build identifier, shown on every screen a tester can reach without signing in.
 *
 * ## Why it exists
 *
 * With a closed test you cannot see the devices. "Which version are you on?" is otherwise
 * unanswerable, and the answer decides whether a report is a real bug or a build that predates the
 * fix. Placed on the pre-auth screens specifically: a tester who *cannot sign in* is exactly who
 * most needs to be able to read it.
 *
 * ## Why `expo-application` and not `expo-constants`
 *
 * `Constants.expoConfig` reflects the app config, and `versionCode` is assigned by EAS at build time
 * under remote versioning, so reading it from the config risks reporting the stale local fallback
 * (`1`). `expo-application` reads the installed package's own values, so it cannot disagree with
 * what Play actually shipped — which is the entire point of a screen whose job is to be authoritative
 * about the version.
 *
 * Both numbers are shown because neither identifies a build alone: the version says what changed,
 * the code says which binary. "1.0.0 (7)" is unambiguous; "1.0.0" is not.
 *
 * Long-press opens `/diagnostics`, which is otherwise unreachable from the UI and answers the next
 * question a confused tester creates — whether the phone can reach the API at all.
 */
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Application from 'expo-application';

import { AppText } from './AppText';
import { fontSize, spacing, useTheme } from '@/theme';

export function VersionBadge() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Null in Expo Go and on the web, where there is no installed package to read. Rendering "v null"
  // would look like a bug in the very component people are meant to trust.
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  if (!version) return null;

  return (
    <Pressable
      onLongPress={() => router.push('/diagnostics')}
      delayLongPress={800}
      accessibilityRole="text"
      accessibilityLabel={`App version ${version}${build ? `, build ${build}` : ''}`}
      style={[styles.wrap, { bottom: insets.bottom + spacing[2] }]}
    >
      <AppText style={[styles.text, { color: theme.mutedForeground }]}>
        v{version}
        {build ? ` (${build})` : ''}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Bottom-left, out of the way of the primary actions and outside any scroll content, so it does
  // not move around while the rest of the screen does.
  wrap: {
    position: 'absolute',
    left: spacing[4],
    padding: spacing[1],
  },
  text: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
});

/**
 * Themed screen container: safe-area padding, the app backdrop, and keyboard avoidance.
 *
 * Every screen should sit in one of these rather than styling its own root view, so the backdrop and
 * the notch handling stay in one place.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, useTheme } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** Wrap the content in a ScrollView. On for forms, which must stay reachable above a keyboard. */
  scroll?: boolean;
  /** Centre content vertically — for short screens like sign-in, which look wrong pinned to the top. */
  center?: boolean;
  contentStyle?: ViewStyle;
  /**
   * Pull-to-refresh control. Requires `scroll` — a RefreshControl needs a scrollable to hang from, and
   * passing one without it would silently do nothing.
   */
  refreshControl?: ScrollViewProps['refreshControl'];
}

export function Screen({
  children,
  scroll = false,
  center = false,
  contentStyle,
  refreshControl,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = {
    paddingTop: insets.top + spacing[6],
    paddingBottom: insets.bottom + spacing[6],
    paddingLeft: spacing[6],
    paddingRight: spacing[6],
  };

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padding, center && styles.centered, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padding, center && styles.centered, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.appBackground }]}
      // Android resizes the window itself; adding padding on top of that double-counts the keyboard.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flexGrow: 1, justifyContent: 'center' },
});

/**
 * On-screen popups.
 *
 * The mobile equivalent of the web's `useToast`. Two callers, and they are different in kind:
 *
 * - **Action feedback** — "Task sent for approval", "Signed out that device". Something the user just
 *   did, confirmed where their eyes already are.
 * - **New notifications** — something a *parent* did, arriving while the child has the app open. Until
 *   push lands (P0-3, Phase 4) there is no server→device channel, so `NotificationWatcher` polls the
 *   unread count and raises a toast when it grows. That is the "popup on screen" half of the feature;
 *   the notifications screen is the "in app" half.
 *
 * ## Placement is top, not bottom
 *
 * The bottom of every child screen is the tab bar, and the bottom of several is a primary action.
 * A toast there covers the control the user is most likely to reach for next, and on a task list it
 * would sit directly over "I'm done".
 *
 * ## It never blocks
 *
 * `pointerEvents="box-none"` on the container so taps pass through to the screen underneath; only the
 * toast body itself is touchable, and touching it dismisses. A notice that has to be dismissed before
 * the app responds is a modal, and this is not one.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  /** Run on tap, in place of merely dismissing. */
  onPress?: () => void;
}

interface ToastApi {
  show: (text: string, tone?: ToastTone, onPress?: () => void) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Returns a no-op when no provider is mounted rather than throwing.
 *
 * A toast is never load-bearing — the screen still shows its own error card, the list still refreshes.
 * Crashing a screen because a decorative notice had nowhere to render would be the wrong trade, and it
 * keeps components testable in isolation without wrapping every test in a provider.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => undefined };
}

const VISIBLE_MS = 3200;
const FADE_MS = 200;

function ToastView({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduceMotion ? 0 : -12);

  // Runs once per message — the key on the rendered element guarantees a fresh instance per toast.
  useMemo(() => {
    opacity.value = withTiming(1, { duration: FADE_MS });
    if (!reduceMotion) translateY.value = withTiming(0, { duration: FADE_MS });
  }, [opacity, translateY, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const accent =
    message.tone === 'error'
      ? theme.destructive
      : message.tone === 'success'
        ? theme.primary
        : theme.mutedForeground;

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: theme.card, borderLeftColor: accent, marginTop: insets.top + spacing[2] },
        style,
      ]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        // A toast that announces something and then does nothing when tapped reads as broken — which
        // is exactly how it was reported. When it carries an action, say so; otherwise tapping is
        // only a way to get it out of the way, and the label should not promise more.
        accessibilityLabel={message.onPress ? `${message.text}. Tap to open.` : 'Dismiss'}
      >
        <AppText
          // Announced without stealing focus. `assertive` is deliberate for errors and arrivals
          // alike: a toast that a screen reader never reads is invisible to the user who most needs
          // it, and it disappears before a polite queue would get to it.
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.text, { color: theme.cardForeground }]}
        >
          {message.text}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, tone: ToastTone = 'info', onPress?: () => void) => {
    // One at a time. A stack of toasts on a phone covers the screen it is meant to annotate, and the
    // realistic volume here is one every few minutes — the newest is always the one worth showing.
    if (timer.current) clearTimeout(timer.current);
    const id = nextId.current++;
    setMessage({ id, text, tone, onPress });
    timer.current = setTimeout(() => setMessage(null), VISIBLE_MS);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View style={styles.host} pointerEvents="box-none">
        {message && (
          <ToastView
            key={message.id}
            message={message}
            onDismiss={() => {
              // Dismiss first, then act. Navigating while the toast is still mounted leaves it
              // hanging over the destination for the rest of its timer.
              const act = message.onPress;
              if (timer.current) clearTimeout(timer.current);
              setMessage(null);
              act?.();
            }}
          />
        )}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  toast: {
    width: '100%',
    maxWidth: 560,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    elevation: 6,
  },
  text: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
  },
});

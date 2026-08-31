/**
 * Labelled text input.
 *
 * The label is a real `<AppText>` tied to the input via `accessibilityLabel` rather than a placeholder
 * standing in for one. Placeholder-as-label disappears the moment typing starts and is not announced
 * reliably by screen readers — and Play's Families review does look at TalkBack behaviour.
 *
 * ## Why the reveal toggle lives here rather than at the call sites
 *
 * Every masked field in the app goes through this component: the parent password on login, register,
 * reset-password and accept-invite, and the four-digit child PIN on child-login and child-form. A
 * toggle added here is a toggle on all nine of them, and, more to the point, one that cannot drift
 * apart between them.
 *
 * The PIN is the field that made this worth doing. Four digits, number-pad, fully masked, typed by a
 * child who cannot see whether the keypad registered a tap, and that is the shape of a login failure
 * the user has no way to diagnose.
 *
 * ## Revealing a secret safely
 *
 * Unmasking a password is not just a style change, it hands the value to three things that were
 * previously locked out of it: the IME, the OS screenshot, and anyone stood behind the user. Each is
 * handled below at the point it becomes relevant, and each is the reason a call site must not build
 * its own toggle out of a raw `TextInput`.
 */
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/AppText';

import { subscribeAppFocus } from '@/lib/appFocus';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

interface FieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Per-field validation message. Also flips the border, so the error is not colour-only. */
  error?: string;
  hint?: string;
}

export function Field({ label, error, hint, secureTextEntry, ...inputProps }: FieldProps) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);

  // Only a masked field gets a toggle, and it stays masked on first render: revealing is a deliberate
  // act, never the default, on a device a family shares.
  const maskable = secureTextEntry === true;
  const disabled = inputProps.editable === false;

  /**
   * Re-mask whenever the app stops being the active window.
   *
   * Both platforms photograph the screen on the way out to draw the app-switcher card, and Android
   * keeps that image in recents until the task is dismissed. A password left revealed is therefore a
   * password sitting in a thumbnail that outlives the session. `isFocused` inside `subscribeAppFocus`
   * counts iOS's transitional `inactive` as unfocused, which is the state that fires *before* the
   * snapshot is taken, so this lands in time rather than one state too late.
   *
   * Deliberately not also re-masking on blur. The leak that matters is the one the user cannot see;
   * a revealed field on a screen they are still looking at is a choice they just made, and snapping
   * it shut when they reach for the submit button is the kind of "helpful" that gets a toggle
   * described as broken. The subscription only exists while something is actually revealed.
   */
  useEffect(() => {
    if (!revealed) return;
    return subscribeAppFocus((focused) => {
      if (!focused) setRevealed(false);
    });
  }, [revealed]);

  function toggleReveal() {
    const next = !revealed;
    setRevealed(next);
    // A changed accessible name on an already-focused button is not re-announced by TalkBack or
    // VoiceOver, so without this the user double-taps and hears nothing at all. Announce the state,
    // never the value.
    AccessibilityInfo.announceForAccessibility(`${label} ${next ? 'shown' : 'hidden'}`);
  }

  return (
    <View style={styles.wrapper}>
      <AppText style={[styles.label, { color: theme.mutedForeground }]}>{label}</AppText>
      <View style={styles.inputRow}>
        <TextInput
          // Before the spread, so a call site can still override it. A masked field that capitalises
          // the first character the moment it is revealed looks like the value was typed wrong.
          autoCapitalize={maskable ? 'none' : undefined}
          {...inputProps}
          secureTextEntry={maskable && !revealed}
          /**
           * After the spread, because these two are not the call site's to relax.
           *
           * `secureTextEntry` is what tells the IME "do not learn this". Drop it to reveal the value
           * and the field becomes ordinary text, where `autoCorrect` defaults to true: Android's
           * keyboard can then take the plaintext password into its personal dictionary and offer it
           * as a suggestion later, in a different app. The toggle would have quietly turned a secret
           * into autocomplete. Pinning both off means revealing changes what the user sees and
           * nothing else.
           */
          autoCorrect={maskable ? false : inputProps.autoCorrect}
          spellCheck={maskable ? false : inputProps.spellCheck}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={theme.mutedForeground}
          // Android centres multiline text vertically by default, which looks like a bug in a box tall
          // enough to hold a sentence.
          textAlignVertical={inputProps.multiline ? 'top' : 'center'}
          style={[
            styles.input,
            {
              backgroundColor: theme.card,
              color: theme.cardForeground,
              borderColor: error ? theme.destructive : theme.input,
            },
            inputProps.multiline && styles.multiline,
            // Keeps the value from running under the button rather than letting the two overlap.
            maskable && styles.inputWithToggle,
          ]}
        />
        {maskable && (
          <Pressable
            onPress={toggleReveal}
            disabled={disabled}
            accessibilityRole="button"
            /**
             * The name carries the state, and nothing else does.
             *
             * The alternative is a fixed name plus `accessibilityState={{ checked }}`, which makes a
             * screen reader say "Show password, tick box, ticked" for what is a button. Naming the
             * action the next tap performs is the pattern the ARIA authoring practices settle on for
             * exactly this control, and doubling it up with a toggle state is what they warn against.
             *
             * Named against the field rather than a bare "Show password": register and reset-password
             * both stack a password against a confirmation, and two identically named buttons on one
             * screen leave a screen reader user unable to tell which is which.
             */
            accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${label}`}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [
              styles.toggle,
              { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={ICON_SIZE}
              // Reinforces the state rather than carrying it: the glyph itself already differs, so a
              // user who cannot separate the two colours has lost nothing.
              color={revealed ? theme.foreground : theme.mutedForeground}
              // The Pressable carries the label; the glyph would otherwise be announced as its
              // private-use code point on top of it.
              importantForAccessibility="no"
              accessibilityElementsHidden
            />
          </Pressable>
        )}
      </View>
      {hint !== undefined && !error && (
        <AppText style={[styles.hint, { color: theme.mutedForeground }]}>{hint}</AppText>
      )}
      {error !== undefined && (
        // `alert` so a screen reader announces the message when it appears, rather than only on focus.
        <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}
    </View>
  );
}

/** Sized to read clearly beside 16dp body text; the 44dp target around it comes from `toggle`. */
const ICON_SIZE = 22;

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing[4] },
  label: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[2],
  },
  /** Positioning context for the reveal button, which overlays the input's trailing edge. */
  inputRow: { position: 'relative', justifyContent: 'center' },
  input: {
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize.base.fontSize,
  },
  hint: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[2],
  },
  /** Tall enough for a couple of lines without the user having to scroll inside the box to see them. */
  multiline: { minHeight: minTouchTarget * 2, paddingTop: spacing[3] },
  inputWithToggle: { paddingRight: minTouchTarget },
  /**
   * Full height of the input rather than an icon-sized box, so the target clears 44dp without a
   * hitSlop that would reach outside the field and steal taps meant for the input itself.
   */
  toggle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Child sign-in.
 *
 * Three fields for now: family code, username, PIN. In Phase 2 the family code comes from secure
 * storage after a QR scan and this screen drops to two fields — the code is stored and never shown,
 * so a child cannot read it off their own device. The manual entry below becomes the fallback for a
 * device that cannot scan, not the main path.
 *
 * `childIdentifier` accepts a username or a first name, and the server uppercases and trims the family
 * code, so neither needs policing here. The PIN is exactly 4 digits (`VALIDATION.PIN.PATTERN`), which
 * is checked locally only to avoid a pointless round trip.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

const PIN_LENGTH = 4;

export default function ChildLogin() {
  const theme = useTheme();
  const signInChild = useAuth((state) => state.signInChild);

  const [familyCode, setFamilyCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pinComplete = pin.length === PIN_LENGTH;
  const canSubmit =
    familyCode.trim().length > 0 && identifier.trim().length > 0 && pinComplete && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signInChild(familyCode.trim(), identifier.trim(), pin);
      router.replace('/');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll center>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Sign in</AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Ask your parent for your family code if you don&apos;t know it.
      </AppText>

      <Field
        label="Family code"
        value={familyCode}
        onChangeText={setFamilyCode}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        returnKeyType="next"
      />

      <Field
        label="Username"
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        returnKeyType="next"
      />

      <Field
        label="PIN"
        value={pin}
        onChangeText={(next) => setPin(next.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LENGTH}
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
        hint={`${PIN_LENGTH} digits`}
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button label="Let's go" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        style={styles.backLink}
        disabled={busy}
      >
        <AppText style={[styles.backText, { color: theme.mutedForeground }]}>Go back</AppText>
      </Pressable>
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
    marginBottom: spacing[6],
  },
  error: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[3] },
  actions: { marginTop: spacing[2] },
  backLink: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[4] },
  backText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

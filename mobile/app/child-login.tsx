/**
 * Child sign-in.
 *
 * Two shapes, decided by whether this device has already scanned its parent's QR:
 *
 *   - **Onboarded** — username + PIN. The family code is read from secure storage and **never shown**,
 *     so a child cannot read it off their own phone to hand around. A discreet "not your family?" link
 *     forgets it, for a device passed on to a sibling or reset by a parent.
 *   - **Not onboarded** — the original three fields, plus a prominent route to the scanner.
 *
 * Worth being precise about what hiding the code buys: it raises the friction of casual sharing. It is
 * not confidentiality — `GET /families/me` returns `familyCode` to any signed-in family member — and
 * nothing should be built on the assumption that a child cannot obtain it. See `familyCodeStore.ts`.
 *
 * `childIdentifier` matches on username only (the firstName fallback was removed with the unique-
 * username migration), and the server trims and uppercases the family code, so neither needs policing
 * here. The PIN is checked for length locally only to avoid a pointless round trip.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import { getStoredFamilyCode, setStoredFamilyCode } from '@/lib/familyCodeStore';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

const PIN_LENGTH = 4;

export default function ChildLogin() {
  const theme = useTheme();
  const signInChild = useAuth((state) => state.signInChild);

  /**
   * `undefined` means "still reading the keystore". Distinguished from `null` (nothing stored) so the
   * screen does not flash the three-field form for a frame on an onboarded device — the same reasoning
   * as the root layout's splash during session bootstrap.
   */
  const [storedCode, setStoredCode] = useState<string | null | undefined>(undefined);
  const [familyCode, setFamilyCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => setStoredCode(await getStoredFamilyCode()))();
  }, []);

  const onboarded = typeof storedCode === 'string';
  const effectiveCode = onboarded ? storedCode : familyCode.trim();

  const pinComplete = pin.length === PIN_LENGTH;
  const canSubmit = effectiveCode.length > 0 && identifier.trim().length > 0 && pinComplete && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signInChild(effectiveCode, identifier.trim(), pin);
      router.replace('/');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function forgetDevice() {
    await setStoredFamilyCode(null);
    setStoredCode(null);
    setFamilyCode('');
    setError(null);
  }

  if (storedCode === undefined) {
    return (
      <Screen center>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <Logo width={128} />
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Sign in
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        {onboarded
          ? 'Enter your username and PIN.'
          : 'Scan the code your parent shows you, or type it in below.'}
      </AppText>

      {!onboarded && (
        <View style={styles.scanAction}>
          <Button label="Scan my parent's code" onPress={() => router.push('/scan')} disabled={busy} />
        </View>
      )}

      {/* Shown only on a device that has not been onboarded. On one that has, the code is deliberately
          absent from the screen entirely rather than rendered disabled or masked. */}
      {!onboarded && (
        <Field
          label="Family code"
          value={familyCode}
          onChangeText={setFamilyCode}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          returnKeyType="next"
        />
      )}

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

      {onboarded && (
        // For a phone handed to a sibling, or a parent resetting the device. Understated on purpose —
        // it is a rare action, and a prominent "forget" beside a login form invites mis-taps.
        <Pressable
          onPress={() => void forgetDevice()}
          accessibilityRole="button"
          style={styles.link}
          disabled={busy}
        >
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
            Not your family? Use a different code
          </AppText>
        </Pressable>
      )}

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        style={styles.link}
        disabled={busy}
      >
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>Go back</AppText>
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
    marginBottom: spacing[4],
  },
  scanAction: { marginBottom: spacing[5] },
  error: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[3],
  },
  actions: { marginTop: spacing[2] },
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[3] },
  linkText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

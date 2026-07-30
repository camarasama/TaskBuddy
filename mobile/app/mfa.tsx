/**
 * Second leg of an MFA sign-in.
 *
 * Reached only from the parent sign-in screen, carrying the challenge token from `/auth/login`. The
 * token is short-lived and single-purpose: it authorises nothing until it is paired with a TOTP code.
 *
 * It travels as a navigation param, which on expo-router means it is expressible as a URL. That is
 * acceptable here — the token is useless without the code, expires in minutes, and never touches
 * persistent storage — but it is the reason this screen does not keep it anywhere afterwards.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { router, useLocalSearchParams } from 'expo-router';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

/** Authenticator apps emit 6 digits; the backend accepts up to 10 to allow for recovery codes. */
const CODE_MAX = 10;

export default function MfaChallenge() {
  const theme = useTheme();
  const completeMfa = useAuth((state) => state.completeMfa);
  const { mfaToken } = useLocalSearchParams<{ mfaToken?: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = code.trim().length >= 6 && !busy && Boolean(mfaToken);

  async function submit() {
    if (!canSubmit || !mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      await completeMfa(mfaToken, code.trim());
      router.replace('/');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  // Deep-linked here directly, or navigated back to after the param was dropped. There is nothing
  // to complete, so send the user back to the start rather than showing a form that cannot work.
  if (!mfaToken) {
    return (
      <Screen center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Session not found</AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Please sign in again to continue.
        </AppText>
        <View style={styles.actions}>
          <Button label="Back to sign-in" onPress={() => router.replace('/login')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Two-factor code</AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Enter the 6-digit code from your authenticator app.
      </AppText>

      <Field
        label="Authentication code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        // Android autofills the code from a notification when this is set.
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={CODE_MAX}
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
        hint="Codes change every 30 seconds."
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button label="Verify" onPress={submit} busy={busy} disabled={!canSubmit} />
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
    marginBottom: spacing[6],
  },
  error: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[3] },
  actions: { marginTop: spacing[2] },
});

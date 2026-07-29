/**
 * Parent sign-in.
 *
 * Handles the two-outcome shape of `/auth/login`: an MFA-enrolled parent (FR-17) gets a challenge
 * token and *no session*, so a non-null result here means sign-in is not finished and the TOTP screen
 * takes over. Treating that response as success is the bug this screen exists to not have.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

export default function ParentLogin() {
  const theme = useTheme();
  const signInParent = useAuth((state) => state.signInParent);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await signInParent(email.trim(), password);
      if (challenge) {
        // Password accepted, session not issued yet.
        router.push({ pathname: '/mfa', params: { mfaToken: challenge.mfaToken } });
        return;
      }
      // Signed in. The role chooser redirects into the parent shell on its own.
      router.replace('/');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll center>
      <Text style={[styles.title, { color: theme.foreground }]}>Parent sign-in</Text>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
        returnKeyType="next"
      />

      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {error !== null && (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        <Button label="Sign in" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        style={styles.backLink}
        disabled={busy}
      >
        <Text style={[styles.backText, { color: theme.mutedForeground }]}>Not a parent? Go back</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[6],
  },
  error: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[3] },
  actions: { marginTop: spacing[2] },
  backLink: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[4] },
  backText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

/**
 * Set a new password from an emailed reset token.
 *
 * ## The token can arrive two ways, and only one of them is a route param
 *
 * The reset email links to `${FRONTEND_URL}/reset-password?token=…` — the *website*. No Android App
 * Link is registered for gettaskbuddy.com, so tapping that button on a phone opens a browser, not
 * this screen. A tester therefore reaches here by navigating from the sign-in screen and pasting the
 * link, which is why a missing `token` param shows a paste field rather than the dead end the web
 * page shows ("this link is missing its token"). `extractToken` accepts the whole URL or the bare
 * token, so the instruction can be "paste the link".
 *
 * The param path still works, and is what a future deep link will use — nothing here needs to change
 * when one is registered.
 *
 * ## The token is never stored
 *
 * It lives in component state for the life of this screen and goes nowhere else: not the keystore,
 * not a log line. It is a bearer credential for changing a password, and a reset that leaves one
 * lying around is worse than no reset. Neither the token nor either password is ever logged.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import {
  extractToken,
  fieldErrors,
  NEW_PASSWORD_MIN_LENGTH,
  resetPassword,
} from '@/lib/authApi';
import { describeError } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

export default function ResetPassword() {
  const theme = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ token?: string }>();

  /**
   * Seeded from the route param once, then owned by this component. A `useState` initialiser rather
   * than a derived value so pasting a different link does not fight the param on the next render.
   */
  const [token, setToken] = useState(() =>
    typeof params.token === 'string' ? extractToken(params.token) : ''
  );
  const [pasted, setPasted] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && confirmPassword.length > 0 && !busy;

  // Not named `use…`: eslint's rules-of-hooks treats any such identifier as a hook and rejects
  // calling it from an event handler.
  function applyPastedToken() {
    const next = extractToken(pasted);
    if (next.length === 0) {
      setError('Paste the reset link from your email, or the code it contains.');
      return;
    }
    setToken(next);
    setError(null);
  }

  async function submit() {
    if (!canSubmit) return;

    const local: Record<string, string> = {};
    if (password.length < NEW_PASSWORD_MIN_LENGTH) {
      local.newPassword = `At least ${plural(NEW_PASSWORD_MIN_LENGTH, 'character')}.`;
    }
    if (confirmPassword !== password) local.confirmPassword = 'Passwords do not match.';
    if (Object.keys(local).length > 0) {
      setFields(local);
      setError(null);
      return;
    }

    setBusy(true);
    setFields({});
    setError(null);
    try {
      await resetPassword(token, password);
      toast.show('Password changed. Sign in with your new one.', 'success');
      router.replace('/login');
    } catch (caught) {
      const fromServer = fieldErrors(caught);
      setFields(fromServer);
      setError(
        Object.keys(fromServer).length > 0
          ? 'Please check the highlighted fields.'
          : describeError(caught)
      );
      setBusy(false);
    }
  }

  // No token yet — ask for the link instead of showing a form that cannot succeed.
  if (token.length === 0) {
    return (
      <Screen scroll center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Paste your reset link
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Open the email we sent, copy the reset link, and paste the whole thing below.
        </AppText>

        <Field
          label="Reset link"
          value={pasted}
          onChangeText={setPasted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!busy}
          hint="Links expire an hour after they are sent."
        />

        {error !== null && (
          <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
            {error}
          </AppText>
        )}

        <View style={styles.actions}>
          <Button label="Continue" onPress={applyPastedToken} disabled={pasted.trim().length === 0} />
        </View>

        <Pressable
          onPress={() => router.replace('/forgot-password')}
          accessibilityRole="button"
          style={styles.link}
        >
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
            Send me a new link
          </AppText>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Choose a new password
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        You will be signed out everywhere else once this is done.
      </AppText>

      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!busy}
        error={fields.newPassword}
        hint={`At least ${plural(NEW_PASSWORD_MIN_LENGTH, 'character')}. Passwords found in known breaches are refused.`}
        returnKeyType="next"
      />

      <Field
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!busy}
        error={fields.confirmPassword}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button label="Set new password" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

      <Pressable
        onPress={() => router.replace('/forgot-password')}
        accessibilityRole="button"
        style={styles.link}
        disabled={busy}
      >
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
          Link expired? Request a new one
        </AppText>
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
    marginBottom: spacing[5],
  },
  error: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[3],
  },
  actions: { marginTop: spacing[2] },
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[3] },
  linkText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

/**
 * Request a password-reset email.
 *
 * ## Why success and "no such account" look identical
 *
 * `/auth/forgot-password` answers 200 with the same generic message whether or not the address maps
 * to an account, and *also* when the three-per-hour limit for that address has been spent. That is
 * anti-enumeration: an app that said "no account with that email" would turn this form into a tool
 * for discovering which of a list of addresses belong to TaskBuddy families. So this screen must not
 * imply the email was sent, only that it *would* have been.
 *
 * ## What is still worth showing as an error
 *
 * A transport failure or the global 429 — neither reveals anything about an account, and both mean
 * the request did not reach the mailer. Swallowing those (as the web page does) leaves the user
 * watching an inbox nothing is ever going to arrive in. The distinction is drawn by which errors
 * escape `requestPasswordReset` at all: an existence check never does.
 *
 * ## The link lands on the website
 *
 * The email is built from `FRONTEND_URL`, so its button opens gettaskbuddy.com, not the app. Hence
 * the route through to `/reset-password`, which accepts a pasted link.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { requestPasswordReset } from '@/lib/authApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

export default function ForgotPassword() {
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen scroll center>
        <Logo width={128} />
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Check your email
        </AppText>
        {/*
          Carefully worded: "if an account exists". Saying "we sent you an email" would be a claim
          the server deliberately refuses to make, and would be a lie for a mistyped address.
        */}
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          If an account exists for {email.trim()}, a reset link is on its way. It expires in an hour.
        </AppText>

        <Card>
          <AppText style={[styles.cardBody, { color: theme.cardForeground }]}>
            The link opens the TaskBuddy website. To finish here in the app instead, copy the link
            from the email and paste it on the next screen.
          </AppText>
        </Card>

        <View style={styles.actions}>
          <Button label="I have my reset link" onPress={() => router.replace('/reset-password')} />
          <View style={styles.gap} />
          <Button label="Back to sign-in" variant="secondary" onPress={() => router.replace('/login')} />
        </View>

        <Pressable
          onPress={() => {
            setSent(false);
            setError(null);
          }}
          accessibilityRole="button"
          style={styles.link}
        >
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
            Use a different email address
          </AppText>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <Logo width={128} />
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Reset your password
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Enter the email address on your parent account and we will send you a link.
      </AppText>

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
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button label="Send reset link" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

      <Pressable
        onPress={() => router.replace('/reset-password')}
        accessibilityRole="button"
        style={styles.link}
        disabled={busy}
      >
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
          I already have a reset link
        </AppText>
      </Pressable>

      <Pressable
        onPress={() => router.replace('/login')}
        accessibilityRole="button"
        style={styles.link}
        disabled={busy}
      >
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>Back to sign-in</AppText>
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
  cardBody: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  error: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[3],
  },
  actions: { marginTop: spacing[2] },
  gap: { height: spacing[2] },
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[3] },
  linkText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

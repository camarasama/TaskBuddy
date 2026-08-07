/**
 * Consume an email-verification token.
 *
 * Same delivery problem as `reset-password.tsx`: the link in the email points at
 * `${FRONTEND_URL}/verify-email?token=…`, which is the website. With no App Link registered, a
 * tester gets here by pasting. The `token` route param is honoured when present — that is the path a
 * future deep link takes — and its absence is a paste prompt rather than a blank screen.
 *
 * ## Three outcomes, not two
 *
 * `/auth/verify-email` answers 200 for a token it has never seen used *and* for one already spent
 * ("Email already verified"). Only unknown (404) and expired (409) are failures, and only expired is
 * worth offering a resend for — but the two are indistinguishable to a user holding an old email, so
 * both failure paths offer it. Nothing in the app is gated on verification, so this screen is never
 * a wall: every state has a way onwards.
 *
 * The token is held in state and never persisted or logged.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { extractToken, resendVerification, verifyEmail } from '@/lib/authApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

type Status = 'needsToken' | 'verifying' | 'verified' | 'failed';

export default function VerifyEmail() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(() =>
    typeof params.token === 'string' ? extractToken(params.token) : ''
  );
  const [status, setStatus] = useState<Status>(token.length > 0 ? 'verifying' : 'needsToken');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pasted, setPasted] = useState('');
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  /**
   * Runs whenever a token appears — from the param on mount, or from a paste. Guarded on the token
   * being non-empty rather than on status so a re-render cannot fire a second POST for the same
   * token; the effect's dependency is the token itself, which only changes when the user supplies a
   * different one.
   */
  const verify = useCallback(async (value: string) => {
    setStatus('verifying');
    setError(null);
    try {
      const result = await verifyEmail(value);
      // The server distinguishes "verified" from "already verified" in this string, and the
      // difference is worth passing on — the second is reassurance, not an error.
      setMessage(result.message);
      setStatus('verified');
    } catch (caught) {
      setError(describeError(caught));
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    if (token.length === 0) return;
    void verify(token);
  }, [token, verify]);

  function applyPastedToken() {
    const next = extractToken(pasted);
    if (next.length === 0) {
      setError('Paste the verification link from your email, or the code it contains.');
      return;
    }
    setToken(next);
  }

  async function resend() {
    if (email.trim().length === 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      await resendVerification(email.trim());
      // Like the reset flow, the response is deliberately the same whether or not the address is
      // known — so this confirms only that the request was accepted.
      setResent(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setResending(false);
    }
  }

  if (status === 'verifying') {
    return (
      <Screen center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Verifying…
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Checking your link with TaskBuddy.
        </AppText>
      </Screen>
    );
  }

  if (status === 'verified') {
    return (
      <Screen scroll center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Email verified
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          {message ?? 'Your email address is confirmed.'}
        </AppText>
        <View style={styles.actions}>
          {/* The role chooser sends a signed-in user to their shell and everyone else to sign-in. */}
          <Button label="Continue" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const resendBlock = (
    <>
      <Field
        label="Your email address"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!resending}
        hint="We will send a fresh link. Three requests per hour."
        returnKeyType="go"
        onSubmitEditing={resend}
      />
      {resent && (
        <AppText style={[styles.notice, { color: theme.mutedForeground }]}>
          If that address needs verifying, a new link is on its way.
        </AppText>
      )}
      <View style={styles.actions}>
        <Button
          label="Send a new link"
          variant="secondary"
          onPress={resend}
          busy={resending}
          disabled={email.trim().length === 0}
        />
      </View>
    </>
  );

  if (status === 'failed') {
    return (
      <Screen scroll center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          That link did not work
        </AppText>
        <AppText accessibilityRole="alert" style={[styles.body, { color: theme.destructive }]}>
          {error ?? 'The link is invalid or has expired.'}
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Verification links last 24 hours. Nothing in the app is locked while your email is
          unverified — you can keep using TaskBuddy and verify later.
        </AppText>

        {resendBlock}

        <Pressable
          onPress={() => {
            setToken('');
            setPasted('');
            setError(null);
            setStatus('needsToken');
          }}
          accessibilityRole="button"
          style={styles.link}
        >
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
            Paste a different link
          </AppText>
        </Pressable>

        <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={styles.link}>
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>Skip for now</AppText>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Verify your email
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Open the email from TaskBuddy, copy the verification link, and paste the whole thing below.
      </AppText>

      <Field
        label="Verification link"
        value={pasted}
        onChangeText={setPasted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        hint="Links expire 24 hours after they are sent."
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button
          label="Verify"
          onPress={applyPastedToken}
          disabled={pasted.trim().length === 0}
        />
      </View>

      <AppText style={[styles.label, { color: theme.foreground }]}>No email?</AppText>
      {resendBlock}

      <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={styles.link}>
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>Skip for now</AppText>
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
  label: {
    fontSize: fontSize.sm.fontSize,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[6],
    marginBottom: spacing[2],
  },
  notice: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[2],
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

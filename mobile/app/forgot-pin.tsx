/**
 * A child who has forgotten their PIN, asking a grown-up for help.
 *
 * ## Why this screen never sets a new PIN
 *
 * The child has no session and, on this device, no email — they cannot be trusted with reset link
 * delivery even if the backend offered it to them directly. `POST /auth/child/pin-reset/request`
 * emails the family's *parents* instead, and the parent finishes the reset on the web. This screen's
 * only job is to trigger that email and say, correctly, who it went to.
 *
 * ## Why the success message never varies
 *
 * The endpoint answers 200 with the identical body whether or not `familyCode`/`childIdentifier`
 * match a real child — anti-enumeration, exactly like `/auth/forgot-password` (see the note atop
 * `forgot-password.tsx`). Adding a "we couldn't find that child" branch here, however well-intentioned
 * for a confused kid mistyping their username, would rebuild the exact oracle the backend was built to
 * deny: try a family code against a list of usernames and watch which ones say "not found". So this
 * screen shows one outcome for every submission that reaches the server, and reports network failure
 * only when the request never got there at all.
 *
 * ## Why the wording says "a grown-up", not "check your email"
 *
 * `forgot-password.tsx`'s success screen says "check your email" because a parent has one. A child
 * does not — the email lands with their parents. Reusing that copy here would send a child off to
 * look for an inbox that was never going to receive anything.
 *
 * ## Family code handling mirrors child-login.tsx
 *
 * An onboarded device already has the family code in secure storage and child-login never renders it,
 * so a child cannot read it off their own phone. Repeating that field here — even blank — would ask
 * the child to retype something the device already knows and, on a shared or handed-down phone, would
 * put a visible family-code box back on screen. So this screen reads the same stored value and only
 * falls back to asking for it when there isn't one, exactly as child-login.tsx does.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import { getStoredFamilyCode } from '@/lib/familyCodeStore';
import { requestChildPinReset } from '@/lib/authApi';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

export default function ForgotPin() {
  const theme = useTheme();

  // Same `undefined`-while-loading distinction as child-login.tsx, for the same reason: without it
  // the not-onboarded form flashes for a frame on a device that has a stored code.
  const [storedCode, setStoredCode] = useState<string | null | undefined>(undefined);
  const [familyCode, setFamilyCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => setStoredCode(await getStoredFamilyCode()))();
  }, []);

  const onboarded = typeof storedCode === 'string';
  const effectiveCode = onboarded ? storedCode : familyCode.trim();

  const canSubmit = effectiveCode.length > 0 && identifier.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await requestChildPinReset(effectiveCode, identifier.trim());
      setSubmitted(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (storedCode === undefined) {
    return (
      <Screen center>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
      </Screen>
    );
  }

  if (submitted) {
    return (
      <Screen scroll center>
        <Logo width={128} />
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          A grown-up has been told
        </AppText>
        {/*
          "If that matches" carries the same weight as forgot-password's "if an account exists": it is
          a claim the server can actually back, not a promise a mistyped username would break.
        */}
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          If that family and username match, someone in your family has been sent an email. Go find a
          grown-up — they can help you set a new PIN.
        </AppText>

        <Card>
          <AppText style={[styles.cardBody, { color: theme.cardForeground }]}>
            Nothing to check on your phone — the email goes to your family, not to you.
          </AppText>
        </Card>

        <View style={styles.actions}>
          <Button label="Back to sign-in" onPress={() => router.replace('/child-login')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll center>
      <Logo width={128} />
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Forgot your PIN?
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Tell us your username and we will let your family know you need help.
      </AppText>

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
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}

      <View style={styles.actions}>
        <Button label="Ask for help" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

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
    marginBottom: spacing[5],
  },
  cardBody: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  error: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[3],
  },
  actions: { marginTop: spacing[2] },
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[3] },
  linkText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

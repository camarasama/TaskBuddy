/**
 * Accept a co-parent invitation.
 *
 * ## The preview comes first, deliberately
 *
 * `GET /auth/invite-preview` is fetched before any field is shown, so the invitee sees *which*
 * family they are joining and *who* invited them before being asked for a password. Asking first and
 * revealing afterwards would be a good way to get someone to type their details into a stranger's
 * invitation. The preview is also the only place an invalid, expired or already-used token is
 * detected cheaply — the service 404s all three with a message written for a human, which this
 * screen shows verbatim rather than paraphrasing.
 *
 * ## Nothing here chooses the email address
 *
 * The account is created against the address the invitation was issued to. Offering a field for it
 * would imply a choice that does not exist, so the address is shown as context and nothing more.
 *
 * ## Same paste fallback as the other token screens
 *
 * The invite email links to `${FRONTEND_URL}/invite/accept?token=…`. Nothing routes that into the
 * app, so a missing `token` param prompts for the link instead of dead-ending. See
 * `reset-password.tsx` for the full reasoning.
 *
 * The new co-parent is signed in on success, and their email is already marked verified — accepting
 * the emailed link is itself proof of the address.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import {
  acceptInvite,
  DATE_OF_BIRTH_PATTERN,
  extractToken,
  fetchInvitePreview,
  fieldErrors,
  isAdultDateOfBirth,
  MIN_PARENT_AGE_YEARS,
  NEW_PASSWORD_MIN_LENGTH,
} from '@/lib/authApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

const GENDERS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;

type Gender = (typeof GENDERS)[number]['value'];

/** Whole days until the invitation lapses, or null when the date is missing or unparseable. */
function daysUntil(expiresAt: string, now = new Date()): number | null {
  const expiry = asDate(expiresAt);
  if (!expiry) return null;
  return Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000));
}

export default function AcceptInvite() {
  const theme = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(() =>
    typeof params.token === 'string' ? extractToken(params.token) : ''
  );
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['auth', 'invite-preview', token] as const,
    queryFn: ({ signal }) => fetchInvitePreview(token, signal),
    enabled: token.length > 0,
    // A 404 here means the invitation is unusable — unknown, expired or spent. Retrying costs the
    // user a wait and cannot change the answer.
    retry: false,
  });

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    !busy;

  function applyPastedToken() {
    const next = extractToken(pasted);
    if (next.length === 0) {
      setPasteError('Paste the invitation link from your email, or the code it contains.');
      return;
    }
    setPasteError(null);
    setToken(next);
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};

    if (firstName.trim().length > 50) found.firstName = 'At most 50 characters.';
    if (lastName.trim().length > 50) found.lastName = 'At most 50 characters.';

    // Optional on this endpoint — unlike register, where the schema requires it. Only checked when
    // something was typed.
    if (dateOfBirth.length > 0) {
      if (!DATE_OF_BIRTH_PATTERN.test(dateOfBirth)) {
        found.dateOfBirth = 'Use YYYY-MM-DD.';
      } else if (!isAdultDateOfBirth(dateOfBirth)) {
        found.dateOfBirth = `Co-parents must be at least ${plural(MIN_PARENT_AGE_YEARS, 'year')} old.`;
      }
    }

    if (password.length < NEW_PASSWORD_MIN_LENGTH) {
      found.password = `At least ${plural(NEW_PASSWORD_MIN_LENGTH, 'character')}.`;
    }
    if (confirmPassword !== password) found.confirmPassword = 'Passwords do not match.';

    return found;
  }

  async function submit() {
    if (!canSubmit) return;

    const local = validate();
    if (Object.keys(local).length > 0) {
      setFields(local);
      setError(null);
      return;
    }

    setBusy(true);
    setFields({});
    setError(null);
    try {
      const result = await acceptInvite({
        token,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
        dateOfBirth: dateOfBirth || undefined,
        phone: phone.trim() || undefined,
        gender: gender || undefined,
      });

      // Signed in directly, for the same reason register does — see the note there on why this uses
      // zustand's setState rather than a store action.
      useAuth.setState({ status: 'signedIn', user: result.user, offline: false });

      toast.show(`You have joined ${result.family.familyName}.`, 'success');
      router.replace('/');
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

  // ── No token yet ───────────────────────────────────────────────────────────

  if (token.length === 0) {
    return (
      <Screen scroll center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Paste your invitation
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Open the invitation email, copy the link, and paste the whole thing below.
        </AppText>

        <Field
          label="Invitation link"
          value={pasted}
          onChangeText={setPasted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          hint="Invitations last a week."
        />

        {pasteError !== null && (
          <AppText accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>
            {pasteError}
          </AppText>
        )}

        <View style={styles.actions}>
          <Button
            label="Continue"
            onPress={applyPastedToken}
            disabled={pasted.trim().length === 0}
          />
        </View>

        <Pressable onPress={() => router.replace('/login')} accessibilityRole="button" style={styles.link}>
          <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>Back to sign-in</AppText>
        </Pressable>
      </Screen>
    );
  }

  // ── Looking the invitation up ──────────────────────────────────────────────

  if (preview.isPending) {
    return (
      <Screen center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Loading…
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Checking your invitation.
        </AppText>
      </Screen>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Screen scroll center>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Invitation unavailable
        </AppText>
        {/* The service writes these messages for a human: unknown link, already accepted, expired. */}
        <AppText accessibilityRole="alert" style={[styles.body, { color: theme.destructive }]}>
          {describeError(preview.error)}
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Ask the parent who invited you to send a new invitation.
        </AppText>

        <View style={styles.actions}>
          <Button
            label="Paste a different link"
            variant="secondary"
            onPress={() => {
              setToken('');
              setPasted('');
              setPasteError(null);
            }}
          />
          <View style={styles.gap} />
          <Button label="Back to sign-in" onPress={() => router.replace('/login')} />
        </View>
      </Screen>
    );
  }

  // ── The invitation is good ─────────────────────────────────────────────────

  const invite = preview.data;
  const days = daysUntil(invite.expiresAt);

  return (
    <Screen scroll>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Join {invite.familyName}
      </AppText>

      <Card>
        <AppText style={[styles.cardBody, { color: theme.cardForeground }]}>
          {invite.inviterName} invited {invite.email} to join {invite.familyName} on TaskBuddy as a
          co-parent.
        </AppText>
        {days !== null && (
          <AppText style={[styles.cardMeta, { color: theme.mutedForeground }]}>
            {days === 0 ? 'Expires today.' : `Expires in ${plural(days, 'day')}.`}
          </AppText>
        )}
      </Card>

      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        Your account will use {invite.email}. Choose a password and tell us your name.
      </AppText>

      <Field
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={50}
        editable={!busy}
        error={fields.firstName}
        returnKeyType="next"
      />

      <Field
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        autoComplete="family-name"
        textContentType="familyName"
        maxLength={50}
        editable={!busy}
        error={fields.lastName}
        returnKeyType="next"
      />

      <Field
        label="Date of birth (optional)"
        value={dateOfBirth}
        onChangeText={(next) => {
          // Digits in, punctuation inserted — the server accepts YYYY-MM-DD and nothing else.
          const digits = next.replace(/\D/g, '').slice(0, 8);
          setDateOfBirth(
            [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-')
          );
        }}
        keyboardType="number-pad"
        maxLength={10}
        editable={!busy}
        error={fields.dateOfBirth}
        hint="YYYY-MM-DD. Co-parents must be 18 or over."
        returnKeyType="next"
      />

      <Field
        label="Phone number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        editable={!busy}
        error={fields.phone}
        returnKeyType="next"
      />

      <AppText style={[styles.label, { color: theme.foreground }]}>Gender (optional)</AppText>
      <View style={styles.chipRow}>
        {GENDERS.map((option) => {
          const selected = option.value === gender;
          return (
            <Pressable
              key={option.label}
              onPress={() => setGender(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              disabled={busy}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? theme.primary : theme.card,
                  borderColor: selected ? theme.primary : theme.border,
                },
              ]}
            >
              <AppText
                style={[
                  styles.chipLabel,
                  { color: selected ? theme.primaryForeground : theme.cardForeground },
                ]}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!busy}
        error={fields.password}
        hint={`At least ${plural(NEW_PASSWORD_MIN_LENGTH, 'character')}.`}
        returnKeyType="next"
      />

      <Field
        label="Confirm password"
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
        <Button label="Join the family" onPress={submit} busy={busy} disabled={!canSubmit} />
      </View>

      <Pressable
        onPress={() => router.replace('/login')}
        accessibilityRole="button"
        style={styles.link}
        disabled={busy}
      >
        <AppText style={[styles.linkText, { color: theme.mutedForeground }]}>
          Already have an account? Sign in
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
    marginBottom: spacing[4],
  },
  body: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginBottom: spacing[4],
  },
  cardBody: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  cardMeta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  label: {
    fontSize: fontSize.sm.fontSize,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  chip: {
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
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

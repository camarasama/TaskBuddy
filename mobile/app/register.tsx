/**
 * Parent sign-up — creates a family and its first parent.
 *
 * Mirrors `frontend/src/app/register/page.tsx` field for field, with three deliberate departures:
 *
 *   1. **The password floor is 10, not 8.** The web page says 8 and is wrong: every route that sets
 *      a new password is held to `VALIDATION.PASSWORD.NEW_MIN_LENGTH` (F-10). Showing 8 here would
 *      mean showing a rule the API rejects. See `NEW_PASSWORD_MIN_LENGTH` in `authApi.ts`.
 *   2. **Date of birth is a typed field, not a picker.** React Native has no `<input type="date">`,
 *      and a native picker means adding `@react-native-community/datetimepicker` — a native module,
 *      which means a new development build for every tester. Not worth it for one field on one
 *      screen. The input formats digits into YYYY-MM-DD as they are typed, which is the shape the
 *      server demands.
 *   3. **No referral code.** The web reads `?ref=` from a shared link; there is no equivalent entry
 *      point on mobile yet (no App Links registered). The API field is optional, so omitting it
 *      costs nothing — wire it up when mobile has a link to read it from.
 *
 * Registration signs the device in: the route always mints tokens. The account's email is not
 * verified at that point and nothing is gated on it, so the screen says so and moves on rather than
 * parking a new family on a "check your inbox" wall.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import {
  DATE_OF_BIRTH_PATTERN,
  fieldErrors,
  isAdultDateOfBirth,
  MIN_PARENT_AGE_YEARS,
  NEW_PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
  register as registerFamily,
} from '@/lib/authApi';
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

/**
 * Format digits into YYYY-MM-DD as they are typed.
 *
 * Punctuation is inserted rather than required, so the parent types eight digits and cannot produce
 * a shape the server rejects. Stripping non-digits on every keystroke also makes backspacing over a
 * dash behave — the dash simply reappears one character later.
 */
function formatDateOfBirth(next: string): string {
  const digits = next.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

export default function Register() {
  const theme = useTheme();
  const toast = useToast();

  const [familyName, setFamilyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /**
   * Field messages from either source — local pre-checks or the server's `details` array — in one
   * map, because a field can only show one message and the newer one is always the relevant one.
   */
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    familyName.trim().length > 0 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 0 &&
    dateOfBirth.length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    !busy;

  /** The server's rules, restated. Returns the message map so `submit` can decide in one place. */
  function validate(): Record<string, string> {
    const found: Record<string, string> = {};

    if (familyName.trim().length < 2) found.familyName = 'At least 2 characters.';
    if (familyName.trim().length > 100) found.familyName = 'At most 100 characters.';
    if (firstName.trim().length > 50) found.firstName = 'At most 50 characters.';
    if (lastName.trim().length > 50) found.lastName = 'At most 50 characters.';
    // Matching the server's `z.string().email()` exactly is not worth attempting; this catches the
    // typo class (no @, no domain) and leaves the verdict to the server.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'Enter a valid email address.';

    if (!DATE_OF_BIRTH_PATTERN.test(dateOfBirth)) {
      found.dateOfBirth = 'Use YYYY-MM-DD.';
    } else if (!isAdultDateOfBirth(dateOfBirth)) {
      found.dateOfBirth = `You must be at least ${plural(MIN_PARENT_AGE_YEARS, 'year')} old to register.`;
    }

    if (phoneNumber.trim().length > 0 && !PHONE_PATTERN.test(phoneNumber.trim())) {
      found.phoneNumber = 'Use international format, e.g. +233201234567.';
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
      const result = await registerFamily({
        familyName: familyName.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        dateOfBirth,
        phoneNumber: phoneNumber.trim() || undefined,
        gender: gender || undefined,
      });

      /**
       * Set the session directly rather than through a store action.
       *
       * `stores/auth.ts` has `signInParent` / `signInChild` but no `register`, and it is owned
       * elsewhere in this unit — so this screen uses zustand's public `setState`, which the store
       * itself already does at module scope for the session-expiry bridge. If a `register` action
       * is added later, move this call into it; do not add a *second* way for a screen to sign in.
       *
       * No admin check: this endpoint only ever creates parents.
       */
      useAuth.setState({ status: 'signedIn', user: result.user, offline: false });

      toast.show('Account created. Check your email to verify the address.', 'success');
      // Straight into the setup wizard rather than through the role chooser (U6): this route only
      // ever creates parents (see the note above), so there is no role left to infer, and a family
      // with an empty dashboard is exactly the activation drop-off the wizard exists to prevent.
      // `welcome.tsx` is fully skippable and never re-forced on a later sign-in — see its own header.
      router.replace('/(parent)/welcome');
    } catch (caught) {
      const fromServer = fieldErrors(caught);
      setFields(fromServer);
      /**
       * When the server named the fields, the banner would only repeat them — `api.ts` builds its
       * message by joining the same details. Say what to do instead, and let the fields carry the
       * detail.
       */
      setError(
        Object.keys(fromServer).length > 0
          ? 'Please check the highlighted fields.'
          : describeError(caught)
      );
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      {/* Smaller than on the sign-in screens: this form is nine fields long, and a full-size mark
          would push the first of them below the fold on a short phone. */}
      <Logo width={104} />
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        Create your family
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        One account for the grown-ups. You can add children once you are in.
      </AppText>

      <Field
        label="Family name"
        value={familyName}
        onChangeText={setFamilyName}
        autoCapitalize="words"
        maxLength={100}
        editable={!busy}
        error={fields.familyName}
        hint="Shown to everyone in the family, e.g. The Mensahs"
        returnKeyType="next"
      />

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
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
        error={fields.email}
        returnKeyType="next"
      />

      <Field
        label="Date of birth"
        value={dateOfBirth}
        onChangeText={(next) => setDateOfBirth(formatDateOfBirth(next))}
        keyboardType="number-pad"
        maxLength={10}
        editable={!busy}
        error={fields.dateOfBirth}
        hint="YYYY-MM-DD. TaskBuddy is for grown-ups aged 18 and over."
        returnKeyType="next"
      />

      <Field
        label="Phone number (optional)"
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        editable={!busy}
        error={fields.phoneNumber}
        hint="International format, e.g. +233201234567"
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
        hint={`At least ${plural(NEW_PASSWORD_MIN_LENGTH, 'character')}. Passwords found in known breaches are refused.`}
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
        <Button label="Create account" onPress={submit} busy={busy} disabled={!canSubmit} />
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
  },
  body: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginTop: spacing[2],
    marginBottom: spacing[5],
  },
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
  link: { minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing[3] },
  linkText: { fontSize: fontSize.sm.fontSize, textAlign: 'center' },
});

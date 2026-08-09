/**
 * Add or edit a child.
 *
 * The most rule-heavy of the three forms, and the rules are not arbitrary:
 *
 * - **Age 10–16, enforced server-side.** A product boundary tied to the Families policy, not a typo
 *   guard, so the form states it up front instead of letting a parent discover it on submit.
 * - **Username is required, 3–20 of `[a-zA-Z0-9_]`, and unique within the family.** It is what the
 *   child types to sign in; two siblings called Sam need different handles, which is exactly why it
 *   exists separately from `firstName`.
 * - **PIN is exactly four digits**, and on edit it is optional — leaving it blank keeps the existing
 *   one rather than clearing it. Stated on the field, because a blank password box that silently
 *   wipes a credential is a genuinely dangerous default.
 *
 * ## `CONSENT_REQUIRED` is handled specially
 *
 * COPPA verifiable parental consent gates all child-data collection, and adding a child is refused
 * until it completes. The server sends a distinct code precisely so the UI can explain rather than
 * show "forbidden" to a parent who has done nothing wrong.
 *
 * The refusal now offers a way out instead of describing one. It routes to `(parent)/consent`, and
 * the server sends the consent email on this first refusal, so the "check your email" instruction
 * refers to a message that actually exists. Previously it did not: nothing in registration
 * requested consent, so the text sent parents to an empty inbox and, failing that, to the website,
 * which is no help at all on a mobile-only install.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { childrenQuery } from '@/lib/childrenApi';
import { describeError } from '@/lib/errors';
import { pickAndUploadImage } from '@/lib/imageUpload';
import {
  addChild,
  INVALIDATED_BY_PARENT_WRITE,
  isConsentRequired,
  setChildAvatar,
  updateChild,
  type ChildInput,
} from '@/lib/parentWriteApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Server rule: at least 10 and at most 16 years old, checked against today. */
function ageIsAllowed(iso: string): boolean {
  const born = new Date(iso);
  if (Number.isNaN(born.getTime())) return false;
  const now = new Date();
  const min = new Date(now.getFullYear() - 16, now.getMonth(), now.getDate());
  const max = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
  return born >= min && born <= max;
}

export default function ChildForm() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const editing = id !== null;

  const list = useQuery(childrenQuery());
  const existing = list.data?.find((c) => c.id === id) ?? null;

  const [firstName, setFirstName] = useState(existing?.firstName ?? '');
  const [lastName, setLastName] = useState(existing?.lastName ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [dob, setDob] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);

  const usernameValid =
    username.trim().length >= 3 && username.trim().length <= 20 && USERNAME_PATTERN.test(username.trim());
  const dobValid = editing ? true : ageIsAllowed(dob);
  const pinValid = pin === '' ? editing : /^\d{4}$/.test(pin);
  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    usernameValid &&
    dobValid &&
    pinValid &&
    !busy;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_PARENT_WRITE.map((key) =>
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
      )
    );
  }, [queryClient]);

  const { mutateAsync: doAdd } = useMutation({ mutationFn: addChild });
  const { mutateAsync: doUpdate } = useMutation({
    mutationFn: ({ childId, input }: { childId: string; input: Partial<ChildInput> }) =>
      updateChild(childId, input),
  });

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setConsentNeeded(false);

    try {
      if (editing && id) {
        await doUpdate({
          childId: id,
          input: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            username: username.trim().toLowerCase(),
            // Omitted entirely when blank — sending an empty string would be a request to change it.
            ...(pin === '' ? {} : { pin }),
          },
        });
      } else {
        await doAdd({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim().toLowerCase(),
          dateOfBirth: dob,
          pin,
        });
      }
      await invalidate();
      toast.show(editing ? 'Child saved' : 'Child added', 'success');
      router.back();
    } catch (caught) {
      if (isConsentRequired(caught)) setConsentNeeded(true);
      setError(describeError(caught));
      setBusy(false);
    }
  }

  /** Avatar is edit-only: there is no child id to attach it to until the record exists. */
  async function chooseAvatar() {
    if (!id) return;
    setUploading(true);
    setError(null);
    try {
      const url = await pickAndUploadImage();
      // null means cancelled or permission refused — both ordinary, neither an error.
      if (!url) return;
      await setChildAvatar(id, url);
      await invalidate();
      toast.show('Picture updated', 'success');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {editing ? 'Edit child' : 'Add a child'}
        </AppText>

        <Field label="First name" value={firstName} onChangeText={setFirstName} editable={!busy} />
        <Field label="Last name" value={lastName} onChangeText={setLastName} editable={!busy} />

        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          maxLength={20}
          hint="What they type to sign in. Letters, numbers and _ only, 3–20 characters."
        />

        {!editing && (
          <Field
            label="Date of birth"
            value={dob}
            onChangeText={setDob}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            editable={!busy}
            hint={
              dob.length > 0 && !dobValid
                ? 'TaskBuddy is for children aged 10 to 16.'
                : 'YYYY-MM-DD. TaskBuddy is for ages 10–16.'
            }
          />
        )}

        <Field
          label={editing ? 'New PIN (optional)' : 'PIN'}
          value={pin}
          onChangeText={(next) => setPin(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          editable={!busy}
          hint={editing ? 'Leave blank to keep their current PIN.' : '4 digits.'}
        />

        {editing && (
          <Card>
            <AppText style={[styles.hint, { color: theme.cardForeground }]}>
              Profile picture
            </AppText>
            <View style={styles.gap} />
            <Button
              label={uploading ? 'Uploading…' : 'Choose a picture'}
              variant="secondary"
              onPress={() => void chooseAvatar()}
              busy={uploading}
              disabled={busy}
            />
          </Card>
        )}

        {consentNeeded && (
          <Card style={{ borderColor: theme.primary, borderWidth: 2 }}>
            <AppText style={[styles.hint, { color: theme.cardForeground }]}>
              {error ??
                'Before adding a child we need to confirm you’re their parent. Check your email for the confirmation link.'}
            </AppText>
            <View style={styles.gap} />
            <Button
              label="Confirm I'm the parent"
              variant="secondary"
              onPress={() => router.push('/(parent)/consent')}
              disabled={busy}
            />
          </Card>
        )}

        {error !== null && !consentNeeded && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
            <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
              {error}
            </AppText>
          </Card>
        )}

        <View style={styles.actions}>
          <Button
            label={editing ? 'Save changes' : 'Add child'}
            onPress={() => void submit()}
            busy={busy}
            disabled={!canSubmit}
          />
          <View style={styles.gap} />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  hint: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { marginTop: spacing[5], marginBottom: spacing[6] },
  gap: { height: spacing[2] },
});

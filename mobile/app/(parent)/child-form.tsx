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
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DateField } from '@/components/DateField';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import {
  childrenQuery,
  clearGrace,
  clearStreakPause,
  grantGrace,
  setStreakPause,
  toDayString,
} from '@/lib/childrenApi';
import { describeError } from '@/lib/errors';
import { useFreshOnFocus } from '@/lib/useFreshOnFocus';
import { pickAndUploadImage } from '@/lib/imageUpload';
import {
  addChild,
  INVALIDATED_BY_PARENT_WRITE,
  isConsentRequired,
  setChildAvatar,
  updateChild,
  type ChildInput,
} from '@/lib/parentWriteApi';
import { AGE_LIMITS, GRACE_GRANT_HOURS, MAX_STREAK_PAUSE_DAYS, isAgeBetween } from '@taskbuddy/shared';

import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * The picker cannot offer an out-of-range date, so these bounds are the primary guard and the
 * validation below is the backstop. Recomputed per render rather than module-scoped: a module
 * constant is captured when the bundle loads and would go stale in an app left open overnight.
 */
function childDobBounds() {
  const now = new Date();
  return {
    // Oldest permissible: the day after their (CHILD_MAX + 1)th birthday.
    minimumDate: new Date(now.getFullYear() - AGE_LIMITS.CHILD_MAX - 1, now.getMonth(), now.getDate() + 1),
    // Youngest permissible: exactly CHILD_MIN years ago today.
    maximumDate: new Date(now.getFullYear() - AGE_LIMITS.CHILD_MIN, now.getMonth(), now.getDate()),
  };
}

/**
 * Remounted on every focus, so opening the child form always gives a clean one.
 *
 * This screen is a `Tabs.Screen` with `href: null`, which means it is mounted once and kept forever.
 * Without the changing key it came back holding whatever the last visit left behind: the previously
 * typed values, and a `busy` that was never cleared, which is how "the button is greyed out with the
 * loading animation" survived a save and a trip to another tab. See `useFreshOnFocus`.
 */
export default function ChildForm() {
  return <ChildFormScreen key={useFreshOnFocus()} />;
}

/**
 * A stored grace expiry, or null when there is none or it will not parse.
 *
 * An already-lapsed grant is kept as a Date rather than discarded: the screen compares it to now to
 * decide whether to show "held until…" or offer a fresh grant, and throwing it away here would make
 * a spent grant indistinguishable from never having granted one.
 */
/**
 * "9pm today" / "9pm tomorrow", in the parent's own timezone.
 *
 * Deliberately not a full date: a 24-hour grant always lands today or tomorrow, and spelling out a
 * date for it reads like a deadline rather than a favour. Falls back to a plain time if the day
 * cannot be worked out, which is better than printing nothing next to a promise.
 */
function formatGraceTime(until: Date): string {
  const time = until.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((until.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days === 0) return `${time} today`;
  if (days === 1) return `${time} tomorrow`;
  return time;
}

function parseGrace(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A stored pause date as `YYYY-MM-DD`, or '' when there is none.
 *
 * The value arrives as a JSON string despite `ChildProfile` annotating it as `Date` (see the note on
 * that type), so it is parsed rather than trusted, and a value that will not parse is treated as no
 * pause rather than rendering "Invalid Date" at a parent.
 */
function dayOrEmpty(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : toDayString(d);
}

function ChildFormScreen() {
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
  /**
   * The consent tick. Not part of the field state: it is a statement the adult makes now, not a
   * property of the child, and it must never be prefilled when the form reopens to edit.
   */
  const [consentAccepted, setConsentAccepted] = useState(false);

  /*
    Vacation mode (growth roadmap §11.2). Its own state and its own mutation, deliberately separate
    from the form's Save: a parent pausing a streak has not necessarily edited the name or the PIN,
    and making them press Save afterwards would either lose the pause or apply edits they had not
    finished. `DateField` already emits `YYYY-MM-DD`, which is exactly the shape the endpoint wants.

    Seeded from the loaded child the same way the name fields are, so reopening the screen shows the
    pause that is actually in force rather than two empty boxes over a live holiday.
  */
  const [pauseFrom, setPauseFrom] = useState(dayOrEmpty(existing?.childProfile?.streakPausedFrom));
  const [pauseUntil, setPauseUntil] = useState(dayOrEmpty(existing?.childProfile?.streakPausedUntil));
  const [pauseBusy, setPauseBusy] = useState(false);
  const pauseActive = pauseFrom !== '' && pauseUntil !== '';

  /*
    The one-off grace grant (growth roadmap §11.3). Held as the expiry the SERVER returned rather
    than one computed here, so the line the parent reads is the moment the streak is actually judged
    against instead of a local guess that drifts by the round trip.
  */
  const [graceUntil, setGraceUntil] = useState<Date | null>(
    parseGrace(existing?.childProfile?.graceGrantedUntil),
  );
  const [graceBusy, setGraceBusy] = useState(false);
  const graceActive = graceUntil !== null && graceUntil.getTime() > Date.now();

  const usernameValid =
    username.trim().length >= 3 && username.trim().length <= 20 && USERNAME_PATTERN.test(username.trim());
  const dobValid = editing ? true : isAgeBetween(dob, AGE_LIMITS.CHILD_MIN, AGE_LIMITS.CHILD_MAX);
  const pinValid = pin === '' ? editing : /^\d{4}$/.test(pin);
  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    usernameValid &&
    dobValid &&
    pinValid &&
    // Adding only. Editing does not re-collect consent: it was given once for this child, and
    // re-asking would imply the earlier record had lapsed.
    (editing || consentAccepted) &&
    !busy;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_PARENT_WRITE.map((key) =>
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
      )
    );
  }, [queryClient]);

  /*
    Save or clear the pause. The server owns the rules (forward-only, end not before start, at most
    30 days) and returns a readable message for each, so failures are surfaced verbatim rather than
    re-implemented here, where they would drift the first time the cap changes.
  */
  const savePause = useCallback(async () => {
    if (!id) return;
    setPauseBusy(true);
    try {
      await setStreakPause(id, pauseFrom, pauseUntil);
      await invalidate();
      toast.show('Streak paused for those dates.');
    } catch (caught) {
      toast.show(describeError(caught));
    } finally {
      setPauseBusy(false);
    }
  }, [id, pauseFrom, pauseUntil, toast, invalidate]);

  const removePause = useCallback(async () => {
    if (!id) return;
    setPauseBusy(true);
    try {
      await clearStreakPause(id);
      setPauseFrom('');
      setPauseUntil('');
      await invalidate();
      toast.show('Streak pause removed.');
    } catch (caught) {
      toast.show(describeError(caught));
    } finally {
      setPauseBusy(false);
    }
  }, [id, toast, invalidate]);

  const giveGrace = useCallback(async () => {
    if (!id) return;
    setGraceBusy(true);
    try {
      const until = await grantGrace(id);
      setGraceUntil(new Date(until));
      await invalidate();
      toast.show('Streak held. They have a bit longer.');
    } catch (caught) {
      toast.show(describeError(caught));
    } finally {
      setGraceBusy(false);
    }
  }, [id, toast, invalidate]);

  const takeBackGrace = useCallback(async () => {
    if (!id) return;
    setGraceBusy(true);
    try {
      await clearGrace(id);
      setGraceUntil(null);
      await invalidate();
      toast.show('Extra time removed.');
    } catch (caught) {
      toast.show(describeError(caught));
    } finally {
      setGraceBusy(false);
    }
  }, [id, toast, invalidate]);


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
          consentFormAccepted: true,
        });
      }
      await invalidate();
      toast.show(editing ? 'Child saved' : 'Child added', 'success');
      router.back();
    } catch (caught) {
      if (isConsentRequired(caught)) setConsentNeeded(true);
      setError(describeError(caught));
    } finally {
      // `finally`, not just the catch. On success this screen navigates away, but it is a tab screen
      // and does not unmount, so leaving `busy` true on the happy path left the button greyed out
      // with its spinner the next time the form was opened. The remount in the default export is the
      // primary fix; this makes the state honest on its own terms too.
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
          <DateField
            label="Date of birth"
            value={dob}
            onChange={setDob}
            editable={!busy}
            {...childDobBounds()}
            error={dob.length > 0 && !dobValid
              ? `TaskBuddy is for children aged ${AGE_LIMITS.CHILD_MIN} to ${AGE_LIMITS.CHILD_MAX}.`
              : undefined}
            hint={`TaskBuddy is for ages ${AGE_LIMITS.CHILD_MIN} to ${AGE_LIMITS.CHILD_MAX}.`}
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

        {editing && (
          <Card>
            <AppText style={[styles.hint, { color: theme.cardForeground }]}>
              Something came up tonight?
            </AppText>
            <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
              {graceActive && graceUntil
                ? `${firstName || 'Their'} streak is held until ${formatGraceTime(graceUntil)}. They won't lose it before then.`
                : `Give ${firstName || 'them'} another ${GRACE_GRANT_HOURS} hours before the streak counts today as missed. The task's own deadline doesn't change.`}
            </AppText>
            <View style={styles.gap} />

            <Button
              label={graceActive ? 'Extend again' : 'Give extra time'}
              onPress={() => void giveGrace()}
              busy={graceBusy}
              disabled={busy}
            />
            {graceActive && (
              <>
                <View style={styles.gap} />
                <Button
                  label="Remove extra time"
                  variant="secondary"
                  onPress={() => void takeBackGrace()}
                  disabled={busy || graceBusy}
                />
              </>
            )}
          </Card>
        )}

        {editing && (
          <Card>
            <AppText style={[styles.hint, { color: theme.cardForeground }]}>
              Away from home?
            </AppText>
            <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
              Pause {firstName || 'their'} streak over a holiday. Missed days won&apos;t break it, and
              you won&apos;t get streak reminders while it&apos;s paused. Tasks they do finish still
              count as normal.
            </AppText>
            <View style={styles.gap} />

            {/* minimumDate today on both: the pause is forward-only, so the picker refuses what the
                server would reject anyway, rather than letting a parent choose a date and then be
                told no. */}
            <DateField
              label="From"
              value={pauseFrom}
              onChange={setPauseFrom}
              editable={!pauseBusy && !busy}
              minimumDate={new Date()}
            />
            <DateField
              label="Until"
              value={pauseUntil}
              onChange={setPauseUntil}
              editable={!pauseBusy && !busy}
              minimumDate={pauseFrom ? new Date(`${pauseFrom}T00:00:00`) : new Date()}
              hint={`Up to ${MAX_STREAK_PAUSE_DAYS} days.`}
            />

            <Button
              label={pauseActive ? 'Update pause' : 'Pause streak'}
              onPress={() => void savePause()}
              busy={pauseBusy}
              disabled={busy || pauseFrom === '' || pauseUntil === ''}
            />
            {pauseActive && (
              <>
                <View style={styles.gap} />
                <Button
                  label="Remove pause"
                  variant="secondary"
                  onPress={() => void removePause()}
                  disabled={busy || pauseBusy}
                />
              </>
            )}
          </Card>
        )}

        {/* Immediately before the submit control, per the brief. A Pressable rather than a
            switch: this is an agreement, and a row that reads as a statement with a tick is harder
            to flip by accident than a toggle. */}
        {!editing && (
          <Pressable
            onPress={() => setConsentAccepted((v) => !v)}
            disabled={busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consentAccepted, disabled: busy }}
            accessibilityLabel="I confirm I am this child's parent or legal guardian and consent to TaskBuddy holding their information"
            style={styles.consentRow}
          >
            <View
              style={[
                styles.consentBox,
                {
                  borderColor: consentAccepted ? theme.primary : theme.border,
                  backgroundColor: consentAccepted ? theme.primary : 'transparent',
                },
              ]}
            >
              {consentAccepted && <Ionicons name="checkmark" size={16} color={theme.primaryForeground} />}
            </View>
            <AppText style={[styles.hint, styles.consentText, { color: theme.cardForeground }]}>
              I confirm I am this child&apos;s parent or legal guardian and I consent to TaskBuddy
              holding their information. A confirmation email recording this consent will be sent to
              everyone on this account.
            </AppText>
          </Pressable>
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
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], marginTop: spacing[4] },
  // 22dp with a generous row hit area: the box itself is small, the whole row is the target.
  consentBox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentText: { flex: 1 },
  gap: { height: spacing[2] },
});

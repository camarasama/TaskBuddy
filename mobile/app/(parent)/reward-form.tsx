/**
 * Create or edit a reward.
 *
 * Same create/edit-in-one-screen shape as the task form, and the same rule about validation: the
 * cheap checks run here so a parent gets an inline message, and the server's answer is what the
 * screen reports on submit.
 *
 * ## Caps are two different things and the form says so
 *
 * `maxRedemptionsPerChild` and `maxRedemptionsTotal` are independent, and **blank means unlimited**,
 * not zero. The distinction is load-bearing downstream — the child shop shows "3 left for you" from
 * a number and nothing at all from a null — so the fields are left empty rather than defaulted, and
 * an empty string is sent as `undefined`.
 *
 * ## Collaborative rewards are shown but not explained twice
 *
 * A collaborative reward pools points from every child rather than being bought by one. It is a real
 * flag on the model (FR-09) and the child shop already renders its progress bar, so the toggle is
 * offered here with one line of explanation.
 *
 * ## Preset ideas are an input path, not a second way to create a reward (U5)
 *
 * Same rule as the task form: picking one only fills these fields, nothing is created until submit,
 * and the sheet is offered on create only — on an edit it would overwrite a live reward's own name and
 * price. The presets arrive ranked by what families actually redeem (U19), so the order is meaningful
 * and is left exactly as the server sent it.
 */
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RankedRewardPreset } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DateField } from '@/components/DateField';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useFreshOnFocus } from '@/lib/useFreshOnFocus';
import {
  createReward,
  deleteReward,
  INVALIDATED_BY_PARENT_WRITE,
  updateReward,
  type RewardInput,
} from '@/lib/parentWriteApi';
import { rewardsQuery } from '@/lib/rewardsApi';
import { fillFromRewardPreset, rewardPresetsQuery } from '@/lib/templatesApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

/** Blank means "no cap". Parsed to undefined so the server stores null rather than 0. */
function optionalCount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number.parseInt(trimmed, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Remounted on every focus, so opening the reward form always gives a clean one.
 *
 * This screen is a `Tabs.Screen` with `href: null`, which means it is mounted once and kept forever.
 * Without the changing key it came back holding whatever the last visit left behind: the previously
 * typed values, and a `busy` that was never cleared, which is how "the button is greyed out with the
 * loading animation" survived a save and a trip to another tab. See `useFreshOnFocus`.
 */
export default function RewardForm() {
  return <RewardFormScreen key={useFreshOnFocus()} />;
}

function RewardFormScreen() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const editing = id !== null;

  // The catalogue is a plain (non-infinite) query, so reading the row from its cache is safe here —
  // unlike the task list, which is paginated and filtered.
  const catalogue = useQuery(rewardsQuery());
  const existing = catalogue.data?.rewards.find((r) => r.id === id) ?? null;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [cost, setCost] = useState(String(existing?.pointsCost ?? 50));
  const [perChild, setPerChild] = useState(
    existing?.maxRedemptionsPerChild ? String(existing.maxRedemptionsPerChild) : ''
  );
  const [total, setTotal] = useState(
    existing?.maxRedemptionsTotal ? String(existing.maxRedemptionsTotal) : ''
  );
  const [collaborative, setCollaborative] = useState(existing?.isCollaborative ?? false);
  // Parity with the web's create form (workstream 3): it offers tier and an expiry, mobile did not.
  const [tier, setTier] = useState<'small' | 'medium' | 'large'>(
    (existing?.tier as 'small' | 'medium' | 'large' | undefined) ?? 'small'
  );
  const [expiresAt, setExpiresAt] = useState(
    existing?.expiresAt ? String(existing.expiresAt).slice(0, 10) : ''
  );
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetched only once the sheet is opened — the form is opened far more often than the ideas are
  // asked for, and every request comes out of a rate-limit bucket shared by the whole household.
  const presets = useQuery({ ...rewardPresetsQuery(), enabled: picking && !editing });
  const presetRows = presets.data?.presets ?? [];

  /**
   * Copy a preset's values in and close.
   *
   * The caps and the collaborative flag are deliberately left alone: a preset has no opinion on them,
   * and clearing what the parent already typed would be a surprise rather than a pre-fill.
   */
  function applyPreset(preset: RankedRewardPreset) {
    const fill = fillFromRewardPreset(preset);
    setName(fill.name);
    setDescription(fill.description);
    setCost(fill.cost);
    setPicking(false);
  }

  const pointsCost = Number.parseInt(cost, 10);
  const costValid = Number.isInteger(pointsCost) && pointsCost >= 1 && pointsCost <= 100000;
  const nameValid = name.trim().length >= 2 && name.trim().length <= 100;
  const canSubmit = nameValid && costValid && !busy;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_PARENT_WRITE.map((key) =>
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
      )
    );
  }, [queryClient]);

  const { mutateAsync: doCreate } = useMutation({ mutationFn: createReward });
  const { mutateAsync: doUpdate } = useMutation({
    mutationFn: ({ rewardId, input }: { rewardId: string; input: Partial<RewardInput> }) =>
      updateReward(rewardId, input),
  });
  const { mutateAsync: doDelete } = useMutation({ mutationFn: deleteReward });

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const input: RewardInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      pointsCost,
      maxRedemptionsPerChild: optionalCount(perChild),
      maxRedemptionsTotal: optionalCount(total),
      isCollaborative: collaborative,
      tier,
      /**
       * The server takes a datetime and refuses anything not in the future; the picker hands back a
       * calendar date. Sent as end-of-day UTC so a reward chosen to expire "on the 20th" is still
       * redeemable during the 20th rather than expiring as it begins.
       *
       * Empty string means "no expiry", which the server expects as null, not as an absent field.
       */
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.000Z`).toISOString() : null,
    };

    try {
      if (editing && id) await doUpdate({ rewardId: id, input });
      else await doCreate(input);
      await invalidate();
      toast.show(editing ? 'Reward saved' : 'Reward created', 'success');
      router.back();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      // `finally`, not just the catch. On success this screen navigates away, but it is a tab screen
      // and does not unmount, so leaving `busy` true on the happy path left the button greyed out
      // with its spinner the next time the form was opened. The remount in the default export is the
      // primary fix; this makes the state honest on its own terms too.
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await doDelete(id);
      await invalidate();
      toast.show('Reward deleted', 'success');
      router.back();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      // `finally`, not just the catch. On success this screen navigates away, but it is a tab screen
      // and does not unmount, so leaving `busy` true on the happy path left the button greyed out
      // with its spinner the next time the form was opened. The remount in the default export is the
      // primary fix; this makes the state honest on its own terms too.
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {editing ? 'Edit reward' : 'New reward'}
        </AppText>

        {/* Create only — see the note at the top on why an edit must not be overwritten. */}
        {!editing && (
          <>
            <Button
              label="Need ideas?"
              variant="secondary"
              onPress={() => setPicking(true)}
              disabled={busy}
            />
            <AppText style={[styles.hint, { color: theme.mutedForeground }, styles.afterButton]}>
              Or just fill it in yourself.
            </AppText>
          </>
        )}

        <Field
          label="What is it?"
          value={name}
          onChangeText={setName}
          editable={!busy}
          maxLength={100}
          hint={name.length > 0 && !nameValid ? 'At least 2 characters' : undefined}
        />

        <Field
          label="Any details? (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
          editable={!busy}
        />

        <Field
          label="Points to buy it"
          value={cost}
          onChangeText={(next) => setCost(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint={!costValid && cost.length > 0 ? 'Between 1 and 100,000' : undefined}
        />

        <Field
          label="Limit per child (optional)"
          value={perChild}
          onChangeText={(next) => setPerChild(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint="Leave blank for no limit"
        />

        <Field
          label="Limit for the whole family (optional)"
          value={total}
          onChangeText={(next) => setTotal(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint="Leave blank for no limit"
        />

        {/* ── Parity block: both existed on the web create form with no mobile equivalent ── */}

        <Card>
          <AppText style={[styles.sectionTitle, { color: theme.mutedForeground }]}>SIZE</AppText>
          <View style={styles.chipRow}>
            {(['small', 'medium', 'large'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setTier(option)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ selected: tier === option }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: tier === option ? theme.primary : theme.card,
                    borderColor: tier === option ? theme.primary : theme.border,
                  },
                ]}
              >
                <AppText
                  style={[styles.chipLabel, { color: tier === option ? theme.primaryForeground : theme.cardForeground }]}
                >
                  {option === 'small' ? 'Small' : option === 'medium' ? 'Medium' : 'Big'}
                </AppText>
              </Pressable>
            ))}
          </View>
        </Card>

        <DateField
          label="Expires (optional)"
          value={expiresAt}
          onChange={setExpiresAt}
          editable={!busy}
          hint="Leave blank and it never expires. It stays redeemable for the whole of the day you pick."
          // The server refuses a past expiry, so tomorrow is the earliest offerable date.
          minimumDate={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })()}
        />

        <Pressable
          onPress={() => setCollaborative((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: collaborative }}
          disabled={busy}
          style={styles.checkRow}
        >
          <AppText style={[styles.checkMark, { color: collaborative ? theme.primary : theme.border }]}>
            {collaborative ? '☑' : '☐'}
          </AppText>
          <AppText style={[styles.checkLabel, { color: theme.foreground }]}>
            Everyone saves for it together
          </AppText>
        </Pressable>

        {error !== null && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
            <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
              {error}
            </AppText>
          </Card>
        )}

        <View style={styles.actions}>
          <Button
            label={editing ? 'Save changes' : 'Create reward'}
            onPress={() => void submit()}
            busy={busy}
            disabled={!canSubmit}
          />
          <View style={styles.gap} />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={busy} />
          {editing && (
            <>
              <View style={styles.gap} />
              <Button
                label="Delete reward"
                variant="secondary"
                onPress={() => void remove()}
                disabled={busy}
              />
            </>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={picking}
        transparent
        animationType="slide"
        onRequestClose={() => setPicking(false)}
      >
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close ideas"
          onPress={() => setPicking(false)}
        />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <AppText style={[styles.sheetTitle, { color: theme.cardForeground }]}>Reward ideas</AppText>
          <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
            Pick one to fill the form. You can change anything before saving.
          </AppText>

          <ScrollView style={styles.sheetList}>
            {presets.isPending ? (
              <AppText style={[styles.hint, { color: theme.mutedForeground }]}>Loading…</AppText>
            ) : presets.isError ? (
              <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
                {describeError(presets.error)}
              </AppText>
            ) : presetRows.length === 0 ? (
              <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
                No ideas available right now.
              </AppText>
            ) : (
              presetRows.map((preset) => (
                <Pressable
                  key={preset.name}
                  onPress={() => applyPreset(preset)}
                  accessibilityRole="button"
                  accessibilityLabel={`${preset.name}, ${preset.pointsCost} points`}
                  style={[styles.presetRow, { borderColor: theme.border }]}
                >
                  <AppText style={[styles.presetName, { color: theme.cardForeground }]}>
                    {preset.name}
                  </AppText>
                  <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
                    {preset.pointsCost} points
                    {/* Say WHY it sits where it does — an unexplained order just looks arbitrary. */}
                    {preset.familyRedemptions > 0
                      ? ` · redeemed ${preset.familyRedemptions}× here`
                      : ''}
                    {preset.alreadyAdded ? ' · you already have this one' : ''}
                  </AppText>
                </Pressable>
              ))
            )}
          </ScrollView>

          {/* Backing out with no preset chosen must be as easy as choosing one. */}
          <Button label="No thanks" variant="secondary" onPress={() => setPicking(false)} />
        </View>
      </Modal>
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
  sectionTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
    marginBottom: spacing[2],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: minTouchTarget,
    marginTop: spacing[3],
  },
  checkMark: { fontSize: fontSize.lg.fontSize },
  checkLabel: { fontSize: fontSize.base.fontSize, flexShrink: 1 },
  actions: { marginTop: spacing[5], marginBottom: spacing[6] },
  gap: { height: spacing[2] },
  afterButton: { marginTop: spacing[2], marginBottom: spacing[4] },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    padding: spacing[5],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetTitle: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[1],
  },
  /** Capped so a long list scrolls inside the sheet instead of pushing the exit button off-screen. */
  sheetList: { maxHeight: 320, marginVertical: spacing[3] },
  presetRow: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
    minHeight: minTouchTarget,
  },
  presetName: { fontSize: fontSize.base.fontSize, fontWeight: fontWeight.medium },
});

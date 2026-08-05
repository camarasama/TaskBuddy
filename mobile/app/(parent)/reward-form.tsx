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
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import {
  createReward,
  deleteReward,
  INVALIDATED_BY_PARENT_WRITE,
  updateReward,
  type RewardInput,
} from '@/lib/parentWriteApi';
import { rewardsQuery } from '@/lib/rewardsApi';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

/** Blank means "no cap". Parsed to undefined so the server stores null rather than 0. */
function optionalCount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number.parseInt(trimmed, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export default function RewardForm() {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    };

    try {
      if (editing && id) await doUpdate({ rewardId: id, input });
      else await doCreate(input);
      await invalidate();
      toast.show(editing ? 'Reward saved' : 'Reward created', 'success');
      router.back();
    } catch (caught) {
      setError(describeError(caught));
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
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {editing ? 'Edit reward' : 'New reward'}
        </AppText>

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
});

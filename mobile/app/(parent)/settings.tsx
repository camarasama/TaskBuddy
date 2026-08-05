/**
 * Family settings.
 *
 * Four switches and a number, each of which changes how the app behaves for every child in the
 * family — so each carries a line saying what it actually does rather than only its name. "Enable
 * leaderboard" tells a parent nothing about the child who always comes last.
 *
 * ## Saved on change, not behind a Save button
 *
 * Every field is independent and idempotent, and the endpoint takes a partial. A Save button would
 * add a step, a dirty state, and a way to lose changes by navigating away. The trade is that a failed
 * write must visibly revert — which it does, because the switch renders from the query and the query
 * is invalidated after every mutation, so a rejected change snaps back rather than lying.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import {
  INVALIDATED_BY_FAMILY_WRITE,
  settingsQuery,
  updateSettings,
  type SettingsInput,
} from '@/lib/familyApi';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

function Toggle({
  label,
  detail,
  value,
  busy,
  onToggle,
}: {
  label: string;
  detail: string;
  value: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: busy }}
      accessibilityLabel={`${label}. ${detail}`}
      style={styles.toggleRow}
    >
      <AppText style={[styles.mark, { color: value ? theme.primary : theme.border }]}>
        {value ? '☑' : '☐'}
      </AppText>
      <View style={styles.toggleText}>
        <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>{label}</AppText>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{detail}</AppText>
      </View>
    </Pressable>
  );
}

export default function Settings() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [grace, setGrace] = useState<string | null>(null);

  const { data, error, isPending, isError, refetch } = useQuery(settingsQuery());
  const settings = data?.settings;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_FAMILY_WRITE.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const { mutateAsync: save } = useMutation({ mutationFn: updateSettings });

  const apply = useCallback(
    async (input: SettingsInput) => {
      setBusy(true);
      try {
        await save(input);
        await invalidate();
      } catch (caught) {
        // The switch reverts on its own — it renders from the query, which the failure left
        // unchanged. The toast explains why it snapped back.
        toast.show(describeError(caught), 'error');
      } finally {
        setBusy(false);
      }
    },
    [save, invalidate, toast]
  );

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError || !settings) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.toggleLabel, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load settings'}
          </AppText>
          <AppText style={[styles.detail, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const graceValue = grace ?? String(settings.streakGracePeriodHours ?? 0);
  const graceNumber = Number.parseInt(graceValue, 10);
  const graceValid = Number.isInteger(graceNumber) && graceNumber >= 0 && graceNumber <= 12;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Family settings
        </AppText>

        <Card>
          <Toggle
            label="Approve recurring tasks automatically"
            detail="Repeating tasks award points as soon as a child marks them done, without waiting for you."
            value={settings.autoApproveRecurringTasks}
            busy={busy}
            onToggle={() =>
              void apply({ autoApproveRecurringTasks: !settings.autoApproveRecurringTasks })
            }
          />
          <Toggle
            label="Daily challenges"
            detail="A small bonus goal each day, with extra points for finishing it."
            value={settings.enableDailyChallenges}
            busy={busy}
            onToggle={() => void apply({ enableDailyChallenges: !settings.enableDailyChallenges })}
          />
          <Toggle
            label="Family leaderboard"
            detail="Ranks your children against each other. Turning it off hides it from everyone — a reasonable choice if one child is always last."
            value={settings.enableLeaderboard}
            busy={busy}
            onToggle={() => void apply({ enableLeaderboard: !settings.enableLeaderboard })}
          />
        </Card>

        <Card>
          <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>
            Streak grace period
          </AppText>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
            Hours after midnight a streak survives an unfinished day. 0 to 12.
          </AppText>
          <Field
            label="Hours"
            value={graceValue}
            onChangeText={(next) => setGrace(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            editable={!busy}
            hint={!graceValid ? 'Between 0 and 12' : undefined}
          />
          <Button
            label="Save grace period"
            variant="secondary"
            onPress={() => {
              if (graceValid) void apply({ streakGracePeriodHours: graceNumber });
            }}
            disabled={busy || !graceValid}
          />
        </Card>

        <Card>
          <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>Co-parents</AppText>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
            Invite another adult, or manage who has access.
          </AppText>
          <View style={styles.action}>
            <Button
              label="Manage co-parents"
              variant="secondary"
              onPress={() => router.push('/(parent)/co-parents')}
            />
          </View>
        </Card>

        <View style={styles.footer} />
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    minHeight: minTouchTarget,
    paddingVertical: spacing[2],
  },
  toggleText: { flex: 1 },
  mark: { fontSize: fontSize.lg.fontSize, marginTop: spacing[1] },
  toggleLabel: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  action: { marginTop: spacing[3] },
  footer: { height: spacing[8] },
});

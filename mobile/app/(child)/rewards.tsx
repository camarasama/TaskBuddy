/**
 * The child's reward shop.
 *
 * Two segments: **Shop** (what can be bought) and **Mine** (what has been bought and whether it has
 * actually arrived) — a redemption is a promise a parent owes, and a child with no way to see "you
 * said yes but haven't given it to me" has no way to chase it.
 *
 * **Ordering.** Affordable rewards first, under "You can get these now": a shop sorted by price alone
 * opens on things the child cannot have, the opposite of motivating. The pinned goal leads regardless.
 *
 * **Deliberate: redeeming asks first.** Spending points is irreversible from the child's side, and a
 * confirm step is the difference between a considered purchase and a mis-tap costing weeks of chores.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChildGoal } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { clampPercent, ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import {
  childRewardsQuery,
  clearGoal,
  INVALIDATED_BY_REWARD_ACTION,
  myRedemptionsQuery,
  redeem,
  redeemBlockedReason,
  setGoal,
  setWishlisted,
  type ChildReward,
  type MyRedemption,
} from '@/lib/childRewardsApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

type Segment = 'shop' | 'mine';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'shop', label: 'Shop' },
  { key: 'mine', label: 'My rewards' },
];

function SegmentChips({ value, onChange }: { value: Segment; onChange: (next: Segment) => void }) {
  const theme = useTheme();

  return (
    <View style={styles.chipRow}>
      {SEGMENTS.map((segment) => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
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
              {segment.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A plain uppercase section label, matching `CardHeading`'s scale without the icon — these sections
 *  are named by list position, not by a gamification accent. */
function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return <AppText style={[styles.sectionHeader, { color: theme.mutedForeground }]}>{title}</AppText>;
}

function RewardRow({
  reward,
  pointsBalance,
  isGoal,
  goalInfo,
  busy,
  onRedeem,
  onToggleWish,
  onToggleGoal,
}: {
  reward: ChildReward;
  pointsBalance: number;
  isGoal: boolean;
  /** The server-computed goal figures, reused verbatim when this row IS the pinned goal so the number
   *  here can never disagree with the one the dashboard just showed. */
  goalInfo: ChildGoal | null;
  busy: boolean;
  onRedeem: () => void;
  onToggleWish: () => void;
  onToggleGoal: () => void;
}) {
  const theme = useTheme();
  const blocked = redeemBlockedReason(reward, pointsBalance);
  const pointsShort = Math.max(0, reward.pointsCost - pointsBalance);
  // "Saving up" only makes sense when points are the one thing standing in the way — an expired,
  // sold-out, or per-child-limit reward stays blocked no matter how many points arrive, so a progress
  // bar there would promise something more points cannot deliver.
  const savingUp = pointsShort > 0 && !reward.isExpired && !reward.isSoldOut && reward.remainingForChild !== 0;
  const percent =
    isGoal && goalInfo
      ? goalInfo.percent
      : clampPercent(reward.pointsCost > 0 ? (pointsBalance / reward.pointsCost) * 100 : 100);
  const pointsToGo = isGoal && goalInfo ? goalInfo.pointsNeeded : pointsShort;

  return (
    <Card status={isGoal ? 'info' : undefined}>
      {isGoal && (
        <AppText style={[styles.badge, { color: theme.primary }]}>YOU&apos;RE SAVING FOR THIS</AppText>
      )}

      <AppText style={[styles.name, { color: theme.cardForeground }]}>{reward.name}</AppText>
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {reward.pointsCost} points
        {reward.remainingForChild !== null ? ` · ${reward.remainingForChild} left for you` : ''}
      </AppText>

      {/* FR-09 pooled rewards: the bar is the whole point of a shared goal. */}
      {reward.collaborative && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          Shared: {reward.collaborative.pooled} of {reward.collaborative.goal} points
          {reward.collaborative.funded ? ' — funded!' : ''}
        </AppText>
      )}

      {savingUp ? (
        <>
          <ProgressBar
            percent={percent}
            variant="points"
            label={`${reward.name}, ${Math.round(percent)} percent saved`}
            style={styles.rewardProgress}
          />
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            {pointsToGo} points to go
          </AppText>
        </>
      ) : (
        blocked && <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{blocked}</AppText>
      )}

      <View style={styles.rowActions}>
        <Button label="Get it" onPress={onRedeem} disabled={busy || blocked !== null} />
        <Button
          label={reward.wishlisted ? 'Un-heart' : 'Heart'}
          variant="secondary"
          onPress={onToggleWish}
          disabled={busy}
        />
        <Button
          label={isGoal ? 'Unpin' : 'Save for'}
          variant="secondary"
          onPress={onToggleGoal}
          disabled={busy}
        />
      </View>
    </Card>
  );
}

function RedemptionRow({ item }: { item: MyRedemption }) {
  const theme = useTheme();

  // Said plainly: "pending"/"approved" are internal words, and what a child wants to know is whether
  // the thing is coming.
  const line =
    item.status === 'fulfilled'
      ? 'Received'
      : item.status === 'cancelled'
        ? 'Cancelled — points refunded'
        : item.status === 'approved'
          ? 'Approved — waiting to get it'
          : 'Waiting for a grown-up';

  return (
    <Card>
      <AppText style={[styles.name, { color: theme.cardForeground }]}>{item.reward.name}</AppText>
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {item.pointsSpent} points · {line}
      </AppText>
    </Card>
  );
}

export default function ChildRewards() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('shop');
  const [confirming, setConfirming] = useState<ChildReward | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Only for redemption. Hearting and pinning are preferences, not achievements. */
  const [celebrating, setCelebrating] = useState<{ message: string; detail?: string } | null>(null);

  const shop = useQuery(childRewardsQuery());
  const mine = useQuery(myRedemptionsQuery());
  // The balance and the pinned goal both live on the dashboard payload, which is already cached — so
  // this costs nothing on a tab switch and guarantees the shop and the home tab quote the same number.
  const dashboard = useQuery(childDashboardQuery());

  const pointsBalance = dashboard.data?.profile.pointsBalance ?? 0;
  const goal = dashboard.data?.goal ?? null;
  const goalRewardId = goal?.rewardId ?? null;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_REWARD_ACTION.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setActingId(id);
      setActionError(null);
      try {
        await action();
        await invalidate();
        return true;
      } catch (caught) {
        setActionError(describeError(caught));
        return false;
      } finally {
        setActingId(null);
      }
    },
    [invalidate]
  );

  const { mutateAsync: doRedeem } = useMutation({ mutationFn: redeem });
  const { mutateAsync: doWish } = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setWishlisted(id, on),
  });
  const { mutateAsync: doGoal } = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: boolean }) => (pin ? setGoal(id) : clearGoal()),
  });

  /**
   * The goal (if pinned) leads regardless of affordability, because it is the one the child chose.
   * Everything else buckets into three named sections, each sorted cheapest-first: what they can
   * afford now, what they're saving for, and what more points would not unlock anyway. Affordable
   * always renders before saving-up, which always renders before the rest — a wall of locked items
   * up top reads as "no" to a child, so the unlockable ones never get pushed below it.
   */
  const shopRows = useMemo(() => {
    const list = shop.data?.rewards ?? [];
    const goalReward = list.find((r) => r.id === goalRewardId) ?? null;
    const rest = list.filter((r) => r.id !== goalRewardId);

    const byPrice = (a: ChildReward, b: ChildReward) => a.pointsCost - b.pointsCost;
    const affordable = rest.filter((r) => redeemBlockedReason(r, pointsBalance) === null).sort(byPrice);
    const savingUp = rest
      .filter((r) => {
        const blocked = redeemBlockedReason(r, pointsBalance);
        return blocked !== null && !r.isExpired && !r.isSoldOut && r.remainingForChild !== 0;
      })
      .sort(byPrice);
    const unavailable = rest
      .filter((r) => r.isExpired || r.isSoldOut || r.remainingForChild === 0)
      .sort(byPrice);

    type Row =
      | { kind: 'header'; key: string; title: string }
      | { kind: 'reward'; key: string; reward: ChildReward };
    const rows: Row[] = [];
    if (goalReward) rows.push({ kind: 'reward', key: goalReward.id, reward: goalReward });
    const section = (title: string, items: ChildReward[]) => {
      if (items.length === 0) return;
      rows.push({ kind: 'header', key: `header-${title}`, title });
      rows.push(...items.map((reward) => ({ kind: 'reward' as const, key: reward.id, reward })));
    };
    section('You can get these now', affordable);
    section('Saving up', savingUp);
    section('Not available right now', unavailable);
    return rows;
  }, [shop.data, goalRewardId, pointsBalance]);

  const active = segment === 'shop' ? shop : mine;

  async function confirmRedeem() {
    if (!confirming) return;
    const name = confirming.name;
    const ok = await runAction(confirming.id, () => doRedeem(confirming.id));
    if (ok) {
      setConfirming(null);
      // Points are gone, but the *thing* is not in hand yet — wording tracks that, not "arrived".
      setCelebrating({ message: 'Got it!', detail: `${name} is on its way` });
    }
  }

  if (active.isPending) {
    return (
      <Screen>
        <SegmentChips value={segment} onChange={setSegment} />
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (active.isError) {
    const offline = active.error instanceof NetworkError;
    return (
      <Screen scroll>
        <SegmentChips value={segment} onChange={setSegment} />
        <Card>
          <AppText style={[styles.name, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load rewards'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(active.error)}
          </AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void active.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SegmentChips value={segment} onChange={setSegment} />

      <AppText style={[styles.balance, { color: theme.foreground }]}>
        {pointsBalance} points to spend
      </AppText>

      {actionError !== null && (
        <Card status="late">
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </AppText>
        </Card>
      )}

      {segment === 'shop' ? (
        <FlatList
          data={shopRows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) =>
            row.kind === 'header' ? (
              <SectionHeader title={row.title} />
            ) : (
              <RewardRow
                reward={row.reward}
                pointsBalance={pointsBalance}
                isGoal={row.reward.id === goalRewardId}
                goalInfo={goal}
                busy={actingId === row.reward.id}
                onRedeem={() => setConfirming(row.reward)}
                onToggleWish={() =>
                  void runAction(row.reward.id, () => doWish({ id: row.reward.id, on: !row.reward.wishlisted }))
                }
                onToggleGoal={() =>
                  void runAction(row.reward.id, () =>
                    doGoal({ id: row.reward.id, pin: row.reward.id !== goalRewardId })
                  )
                }
              />
            )
          }
          ListEmptyComponent={
            <Card>
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                No rewards yet. Ask a grown-up to add some.
              </AppText>
            </Card>
          }
        />
      ) : (
        <FlatList
          data={mine.data?.redemptions ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RedemptionRow item={item} />}
          ListEmptyComponent={
            <Card>
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                You haven&apos;t got anything yet. Keep saving!
              </AppText>
            </Card>
          }
        />
      )}

      <Modal
        visible={confirming !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: theme.card }]}>
            <AppText style={[styles.name, { color: theme.cardForeground }]}>
              Spend {confirming?.pointsCost} points?
            </AppText>
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
              You&apos;ll get {confirming?.name} once a grown-up says yes. You can&apos;t undo this.
            </AppText>
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
              You&apos;ll have {Math.max(0, pointsBalance - (confirming?.pointsCost ?? 0))} points
              left.
            </AppText>

            <View style={styles.rowActions}>
              <Button
                label="Not yet"
                variant="secondary"
                onPress={() => setConfirming(null)}
                disabled={actingId !== null}
              />
              <Button
                label="Yes, get it"
                onPress={() => void confirmRedeem()}
                busy={actingId !== null}
              />
            </View>
          </View>
        </View>
      </Modal>

      {celebrating && (
        <Celebration
          message={celebrating.message}
          detail={celebrating.detail}
          onDone={() => setCelebrating(null)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  rewardProgress: { marginTop: spacing[2] },
  chipRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  chip: {
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  balance: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  badge: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    marginBottom: spacing[1],
  },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] },
  actions: { marginTop: spacing[4] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    padding: spacing[5],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing[1],
  },
});

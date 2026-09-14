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
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChildGoal } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Chip, type ChipVariant } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconButton } from '@/components/IconButton';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { clampPercent, ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { SegmentedControl } from '@/components/SegmentedControl';
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
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

type Segment = 'shop' | 'mine';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'shop', label: 'Shop' },
  { key: 'mine', label: 'My rewards' },
];

function SegmentChips({ value, onChange }: { value: Segment; onChange: (next: Segment) => void }) {
  return <SegmentedControl options={SEGMENTS} value={value} onChange={onChange} />;
}

/** A reward's tile, by size. Rewards carry no artwork, so the tier picks the sticker. */
const TIER_TILE: Record<string, { icon: IoniconName; tone: AccentTone }> = {
  small: { icon: 'star', tone: 'gold' },
  medium: { icon: 'gift', tone: 'peach' },
  large: { icon: 'trophy', tone: 'xp' },
};
const DEFAULT_TILE = { icon: 'gift' as IoniconName, tone: 'gold' as AccentTone };

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
  const tile = (reward.tier && TIER_TILE[reward.tier]) || DEFAULT_TILE;

  return (
    <Card status={isGoal ? 'info' : undefined}>
      {isGoal && (
        <View style={styles.goalBadge}>
          <Chip compact variant="primary" icon="flag" label="You're saving for this" />
        </View>
      )}

      <View style={styles.headRow}>
        <IconTile tone={tile.tone} icon={tile.icon} size={48} />
        <View style={styles.grow}>
          <AppText style={[styles.name, { color: theme.cardForeground }]}>{reward.name}</AppText>
          <View style={styles.chipRow}>
            <Chip compact variant="gold" icon="star" label={`${reward.pointsCost} points`} />
            {reward.remainingForChild !== null && (
              <Chip compact variant="info" label={`${reward.remainingForChild} left for you`} />
            )}
          </View>
        </View>
      </View>

      {/* FR-09 pooled rewards: the bar is the whole point of a shared goal. */}
      {reward.collaborative && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          Shared: {reward.collaborative.pooled} of {reward.collaborative.goal} points
          {reward.collaborative.funded ? ', funded!' : ''}
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

      {/* One real purchase button, and the two preferences as icons beside it. */}
      <View style={styles.rowActions}>
        <View style={styles.grow}>
          <Button label="Get it" onPress={onRedeem} disabled={busy || blocked !== null} />
        </View>
        <IconButton
          icon={reward.wishlisted ? 'heart' : 'heart-outline'}
          label={reward.wishlisted ? 'Un-heart' : 'Heart'}
          tone="destructive"
          active={Boolean(reward.wishlisted)}
          onPress={onToggleWish}
          disabled={busy}
        />
        <IconButton
          icon={isGoal ? 'flag' : 'flag-outline'}
          label={isGoal ? 'Unpin' : 'Save for'}
          tone="primary"
          active={isGoal}
          onPress={onToggleGoal}
          disabled={busy}
        />
      </View>
    </Card>
  );
}

/** Where a redemption is, as a pill a child can read at a glance. */
const REDEMPTION_STATE: Record<string, { label: string; variant: ChipVariant; icon: IoniconName }> = {
  fulfilled: { label: 'Received', variant: 'done', icon: 'checkmark-circle' },
  cancelled: { label: 'Cancelled, points refunded', variant: 'late', icon: 'close-circle' },
  approved: { label: 'Approved, on its way', variant: 'info', icon: 'thumbs-up' },
  pending: { label: 'Waiting for a grown-up', variant: 'xp', icon: 'hourglass-outline' },
};

function RedemptionRow({ item }: { item: MyRedemption }) {
  const theme = useTheme();
  // Said plainly: "pending"/"approved" are internal words, and what a child wants to know is whether
  // the thing is coming.
  const state = REDEMPTION_STATE[item.status] ?? REDEMPTION_STATE.pending;

  return (
    <Card>
      <View style={styles.headRow}>
        <IconTile tone={item.status === 'fulfilled' ? 'success' : 'gold'} icon="gift" size={44} />
        <View style={styles.grow}>
          <AppText style={[styles.name, { color: theme.cardForeground }]}>{item.reward.name}</AppText>
          <View style={styles.chipRow}>
            <Chip compact variant={state.variant} icon={state.icon} label={state.label} />
            <Chip compact variant="gold" icon="star" label={`${item.pointsSpent} points`} />
          </View>
        </View>
      </View>
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
      | { kind: 'header'; key: string; title: string; icon: IoniconName; tone: AccentTone }
      | { kind: 'reward'; key: string; reward: ChildReward };
    const rows: Row[] = [];
    if (goalReward) rows.push({ kind: 'reward', key: goalReward.id, reward: goalReward });
    const section = (title: string, icon: IoniconName, tone: AccentTone, items: ChildReward[]) => {
      if (items.length === 0) return;
      rows.push({ kind: 'header', key: `header-${title}`, title, icon, tone });
      rows.push(...items.map((reward) => ({ kind: 'reward' as const, key: reward.id, reward })));
    };
    section('You can get these now', 'checkmark-circle', 'success', affordable);
    section('Saving up', 'hourglass', 'gold', savingUp);
    section('Not available right now', 'lock-closed', 'warning', unavailable);
    return rows;
  }, [shop.data, goalRewardId, pointsBalance]);

  const active = segment === 'shop' ? shop : mine;

  // The balance as a masthead, the same gold as the wallet on Home, so the number reads as the same
  // thing on both tabs.
  const header = (
    <GradientHeader
      tone="gold"
      icon="gift"
      eyebrow="Points to spend"
      title={`${pointsBalance}`}
      subtitle="Rewards your family chose for you"
    />
  );

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
        {header}
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
        {header}
        <SegmentChips value={segment} onChange={setSegment} />
        <Card status="late">
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
          ListHeaderComponent={
            <>
              {header}
              <SegmentChips value={segment} onChange={setSegment} />
            </>
          }
          renderItem={({ item: row }) =>
            row.kind === 'header' ? (
              <SectionTitle title={row.title} icon={row.icon} tone={row.tone} />
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
          ListEmptyComponent={<EmptyState emoji="🎁" title="No rewards yet." message="Ask a grown-up to add some." />}
        />
      ) : (
        <FlatList
          data={mine.data?.redemptions ?? []}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              {header}
              <SegmentChips value={segment} onChange={setSegment} />
            </>
          }
          renderItem={({ item }) => <RedemptionRow item={item} />}
          ListEmptyComponent={<EmptyState emoji="🪙" title="You haven't got anything yet." message="Keep saving!" />}
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
            <AppText variant="display" style={[styles.sheetTitle, { color: theme.cardForeground }]}>
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
  rewardProgress: { marginTop: spacing[3] },
  goalBadge: { marginBottom: spacing[3] },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  sheetTitle: { fontSize: fontSize.lg.fontSize, lineHeight: fontSize.lg.lineHeight, fontWeight: fontWeight.bold },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[4] },
  actions: { marginTop: spacing[4] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    padding: spacing[5],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing[1],
  },
});

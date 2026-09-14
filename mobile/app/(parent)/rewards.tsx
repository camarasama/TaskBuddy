/**
 * Rewards, parent side.
 *
 * Ordered by obligation, not by data model: **redemptions awaiting fulfilment first**, because the child
 * has already spent their points and is owed the actual thing. The catalogue below is reference material.
 *
 * As with approvals, fulfilment is **not** optimistic. It is a statement that a real-world object
 * changed hands; showing it as done and then failing the request would leave a parent believing they had
 * settled something they had not, with a child who knows they did not.
 */
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip, type ChipVariant } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  fulfilRedemption,
  INVALIDATED_BY_FULFILMENT,
  outstanding,
  redemptionsQuery,
  rewardsQuery,
  type ParentReward,
  type Redemption,
} from '@/lib/rewardsApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

function when(value: Date | string | null | undefined): string | null {
  const date = asDate(value);
  if (!date) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function RedemptionRow({
  item,
  busy,
  onFulfil,
}: {
  item: Redemption;
  busy: boolean;
  onFulfil: () => void;
}) {
  const theme = useTheme();
  const asked = when(item.createdAt);

  return (
    // `pending`, not a hand-picked border colour: a redemption sitting here is, structurally, exactly
    // the same "waiting on a parent" state as an approval, warm until it is handed over.
    <Card status="pending">
      <View style={styles.row}>
        <Avatar seed={item.child.id} name={item.child.firstName} size={40} />
        <View style={styles.grow}>
          <AppText style={[styles.itemTitle, { color: theme.cardForeground }]} numberOfLines={2}>
            {item.reward.name}
          </AppText>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            {item.child.firstName} redeemed this{asked ? ` on ${asked}` : ''}
          </AppText>
        </View>
        <Chip compact variant="gold" icon="star" label={`${item.pointsSpent} pts`} />
      </View>
      {item.status === 'approved' ? (
        <View style={styles.chips}>
          <Chip compact variant="info" icon="thumbs-up" label="Approved, not yet given" />
        </View>
      ) : null}
      {item.notes ? (
        <AppText style={[styles.notes, { color: theme.cardForeground }]}>&ldquo;{item.notes}&rdquo;</AppText>
      ) : null}
      <View style={styles.action}>
        <Button label="Mark as given" onPress={onFulfil} busy={busy} disabled={busy} />
      </View>
    </Card>
  );
}

/**
 * Whether this reward can still be claimed, and why not if it cannot, as a pill. Stated in words, so
 * availability never depends on noticing a colour.
 */
function availability(reward: ParentReward): { label: string; variant: ChipVariant; icon: IoniconName } {
  if (reward.isExpired) return { label: 'Expired', variant: 'late', icon: 'time' };
  if (reward.isSoldOut) return { label: 'Sold out', variant: 'late', icon: 'close-circle' };
  if (!reward.isActive) return { label: 'Hidden from the shop', variant: 'pending', icon: 'eye-off' };
  if (reward.remainingTotal !== null) {
    return { label: `${reward.remainingTotal} left for the family`, variant: 'info', icon: 'people' };
  }
  return { label: 'Available', variant: 'done', icon: 'checkmark-circle' };
}

/** The same size tiles the child's shop uses, so a parent sees a reward the way the child does. */
const TIER_TILE: Record<string, { icon: IoniconName; tone: AccentTone }> = {
  small: { icon: 'star', tone: 'gold' },
  medium: { icon: 'gift', tone: 'peach' },
  large: { icon: 'trophy', tone: 'xp' },
};

function RewardRow({ reward }: { reward: ParentReward }) {
  const theme = useTheme();
  const expires = when(reward.expiresAt);
  const state = availability(reward);
  const tile = (reward.tier && TIER_TILE[reward.tier]) || TIER_TILE.small;

  return (
    <Card>
      <View style={styles.rowTop}>
        <IconTile tone={tile.tone} icon={tile.icon} size={48} muted={state.variant === 'late'} />
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <AppText style={[styles.itemTitle, styles.grow, { color: theme.cardForeground }]} numberOfLines={2}>
              {reward.name}
            </AppText>
            <Chip compact variant="gold" icon="star" label={`${reward.pointsCost} pts`} />
          </View>
          {reward.description ? (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]} numberOfLines={2}>
              {reward.description}
            </AppText>
          ) : null}
          <View style={styles.chips}>
            <Chip compact variant={state.variant} icon={state.icon} label={state.label} />
            {reward.totalRedemptionsUsed > 0 && (
              <Chip compact variant="xp" label={`Claimed ${reward.totalRedemptionsUsed}×`} />
            )}
            {expires ? <Chip compact variant="pending" icon="calendar" label={`Expires ${expires}`} /> : null}
            {/* FR-09: pooled progress, in numbers rather than a bar: the server owns the arithmetic. */}
            {reward.collaborative ? (
              <Chip
                compact
                variant={reward.collaborative.funded ? 'done' : 'info'}
                icon="people"
                label={
                  reward.collaborative.funded
                    ? 'Group goal reached'
                    : `Group goal: ${reward.collaborative.pooled} of ${reward.collaborative.goal} pts`
                }
              />
            ) : null}
            {/* FR-14: which rewards the children actually want is the most useful signal for a parent. */}
            {reward.wishlistCount ? (
              <Chip
                compact
                variant="late"
                icon="heart"
                label={`On ${reward.wishlistCount} ${reward.wishlistCount === 1 ? 'wishlist' : 'wishlists'}`}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function Rewards() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const catalogue = useQuery(rewardsQuery());
  const redemptions = useQuery(redemptionsQuery());

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: fulfilRedemption,
    onSuccess: async () => {
      setActionError(null);
      await Promise.all(
        INVALIDATED_BY_FULFILMENT.map((key) =>
          queryClient.invalidateQueries({ queryKey: key as unknown as string[] })
        )
      );
    },
    onError: (caught) => setActionError(describeError(caught)),
    onSettled: () => setPendingId(null),
  });

  const fulfil = useCallback(
    (id: string) => {
      setPendingId(id);
      mutation.mutate(id);
    },
    [mutation]
  );

  const owed = useMemo(
    () => outstanding(redemptions.data?.redemptions ?? []),
    [redemptions.data]
  );
  const rewards = useMemo(() => catalogue.data?.rewards ?? [], [catalogue.data]);

  const loading = catalogue.isPending || redemptions.isPending;
  const failed = catalogue.isError || redemptions.isError;
  const failure = catalogue.error ?? redemptions.error;

  const refetchAll = useCallback(() => {
    void catalogue.refetch();
    void redemptions.refetch();
  }, [catalogue, redemptions]);

  if (failed) {
    return (
      <Screen>
        <GradientHeader tone="gold" icon="gift" eyebrow="Rewards" title="Rewards" />
        <Callout kind="danger" title={failure instanceof NetworkError ? 'No connection' : 'Could not load rewards'} live>
          {describeError(failure)}
        </Callout>
        <Button label="Try again" onPress={refetchAll} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <GradientHeader
          tone="gold"
          icon="gift"
          eyebrow="Rewards"
          title={loading ? 'Loading…' : `${rewards.length} in the shop`}
          subtitle={loading ? undefined : owed.length === 0 ? 'Nothing to hand over right now' : `You owe ${owed.length}`}
          actions={[
            { label: 'New reward', icon: 'add', onPress: () => router.push('/(parent)/reward-form') },
            {
              label: 'Need ideas?',
              icon: 'bulb',
              onPress: () => router.push({ pathname: '/(parent)/reward-form', params: { ideas: '1' } }),
            },
          ]}
        />

        {actionError !== null && (
          <Callout kind="danger" live>
            {actionError}
          </Callout>
        )}

        {loading && (
          <View style={styles.centred}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}

        {!loading && (
          <>
            {/* First: things already paid for and not yet handed over. */}
            <SectionTitle title={owed.length === 0 ? 'To hand over' : `You owe ${owed.length}`} icon="gift" tone="warning" />
            {owed.length === 0 ? (
              <Callout kind="success">Every redeemed reward has been given out.</Callout>
            ) : (
              owed.map((item) => (
                <RedemptionRow
                  key={item.id}
                  item={item}
                  busy={pendingId === item.id}
                  onFulfil={() => fulfil(item.id)}
                />
              ))
            )}

            <SectionTitle title="The shop" icon="star" tone="gold" />
            {rewards.length === 0 ? (
              <EmptyState emoji="🎁" title="No rewards yet." message="Tap New reward to add one." />
            ) : (
              rewards.map((reward) => (
                // Tapping edits it: the catalogue is the only route into the edit form.
                <Pressable
                  key={reward.id}
                  onPress={() =>
                    router.push({ pathname: '/(parent)/reward-form', params: { id: reward.id } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${reward.name}`}
                >
                  <RewardRow reward={reward} />
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing[6] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  grow: { flex: 1 },
  itemTitle: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2] },
  notes: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontStyle: 'italic', marginTop: spacing[2] },

  action: { marginTop: spacing[3] },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});

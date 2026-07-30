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
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
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
    <Card style={{ borderColor: theme.primary }}>
      <View style={styles.rowHeader}>
        <Text style={[styles.itemTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {item.reward.name}
        </Text>
        <Text style={[styles.cost, { color: theme.foreground }]}>{item.pointsSpent} pts</Text>
      </View>

      <Text style={[styles.meta, { color: theme.mutedForeground }]}>
        {item.child.firstName} redeemed this{asked ? ` on ${asked}` : ''}
        {item.status === 'approved' ? ' · approved, not yet given' : ''}
      </Text>

      {item.notes ? (
        <Text style={[styles.notes, { color: theme.cardForeground }]}>&ldquo;{item.notes}&rdquo;</Text>
      ) : null}

      <View style={styles.action}>
        <Button label="Mark as given" onPress={onFulfil} busy={busy} disabled={busy} />
      </View>
    </Card>
  );
}

/** The one line that says whether this reward can still be claimed, and why not if it cannot. */
function availability(reward: ParentReward): string {
  if (reward.isExpired) return 'Expired';
  if (reward.isSoldOut) return 'Sold out';
  if (!reward.isActive) return 'Hidden from the shop';
  // null means no cap — distinct from 0, which would mean the cap is reached.
  if (reward.remainingTotal !== null) return `${reward.remainingTotal} left for the family`;
  return 'Available';
}

function RewardRow({ reward }: { reward: ParentReward }) {
  const theme = useTheme();
  const unavailable = reward.isExpired || reward.isSoldOut || !reward.isActive;
  const expires = when(reward.expiresAt);

  return (
    <Card>
      <View style={styles.rowHeader}>
        <Text style={[styles.itemTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {reward.name}
        </Text>
        <Text style={[styles.cost, { color: theme.foreground }]}>{reward.pointsCost} pts</Text>
      </View>

      {reward.description ? (
        <Text style={[styles.meta, { color: theme.mutedForeground }]} numberOfLines={2}>
          {reward.description}
        </Text>
      ) : null}

      {/* Stated in words, so availability never depends on noticing a colour. */}
      <Text
        style={[styles.meta, { color: unavailable ? theme.destructive : theme.mutedForeground }]}
      >
        {availability(reward)}
        {reward.totalRedemptionsUsed > 0 ? ` · claimed ${reward.totalRedemptionsUsed}×` : ''}
        {expires ? ` · expires ${expires}` : ''}
      </Text>

      {/* FR-09: pooled progress, in numbers rather than a bar — the server owns the arithmetic. */}
      {reward.collaborative ? (
        <Text style={[styles.meta, { color: theme.primary }]}>
          {reward.collaborative.funded
            ? 'Group goal reached'
            : `Group goal: ${reward.collaborative.pooled} of ${reward.collaborative.goal} pts`}
        </Text>
      ) : null}

      {/* FR-14 — which rewards the children actually want is the most useful signal for a parent. */}
      {reward.wishlistCount ? (
        <Text style={[styles.meta, { color: theme.mutedForeground }]}>
          On {reward.wishlistCount} {reward.wishlistCount === 1 ? 'wishlist' : 'wishlists'}
        </Text>
      ) : null}
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
        <Text style={[styles.title, { color: theme.foreground }]}>Rewards</Text>
        <Card>
          <Text style={[styles.cardTitle, { color: theme.destructive }]}>
            {failure instanceof NetworkError ? 'No connection' : 'Could not load rewards'}
          </Text>
          <Text style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(failure)}
          </Text>
        </Card>
        <Button label="Try again" onPress={refetchAll} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.foreground }]}>Rewards</Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
          {loading ? 'Loading…' : `${rewards.length} in the shop`}
        </Text>

        {actionError !== null && (
          <Card style={{ borderColor: theme.destructive }}>
            <Text accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {actionError}
            </Text>
          </Card>
        )}

        {loading && (
          <View style={styles.centred}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}

        {!loading && (
          <>
            {/* First: things already paid for and not yet handed over. */}
            <Text style={[styles.sectionTitle, { color: theme.foreground }]}>
              {owed.length === 0 ? 'Nothing to hand over' : `You owe ${owed.length}`}
            </Text>
            {owed.length === 0 ? (
              <Card>
                <Text style={[styles.meta, { color: theme.cardForeground }]}>
                  Every redeemed reward has been given out.
                </Text>
              </Card>
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

            <Text style={[styles.sectionTitle, { color: theme.foreground }]}>The shop</Text>
            {rewards.length === 0 ? (
              <Card>
                <Text style={[styles.meta, { color: theme.cardForeground }]}>
                  No rewards yet. Creating them is on the web for now.
                </Text>
              </Card>
            ) : (
              rewards.map((reward) => <RewardRow key={reward.id} reward={reward} />)
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing[6] },
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[1],
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[3],
    marginTop: spacing[2],
  },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  itemTitle: {
    flex: 1,
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  cost: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.bold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  notes: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontStyle: 'italic',
    marginTop: spacing[2],
  },
  action: { marginTop: spacing[4] },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});

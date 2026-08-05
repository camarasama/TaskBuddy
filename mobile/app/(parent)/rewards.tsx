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
        <AppText style={[styles.itemTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {item.reward.name}
        </AppText>
        <AppText style={[styles.cost, { color: theme.foreground }]}>{item.pointsSpent} pts</AppText>
      </View>

      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {item.child.firstName} redeemed this{asked ? ` on ${asked}` : ''}
        {item.status === 'approved' ? ' · approved, not yet given' : ''}
      </AppText>

      {item.notes ? (
        <AppText style={[styles.notes, { color: theme.cardForeground }]}>&ldquo;{item.notes}&rdquo;</AppText>
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
        <AppText style={[styles.itemTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {reward.name}
        </AppText>
        <AppText style={[styles.cost, { color: theme.foreground }]}>{reward.pointsCost} pts</AppText>
      </View>

      {reward.description ? (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]} numberOfLines={2}>
          {reward.description}
        </AppText>
      ) : null}

      {/* Stated in words, so availability never depends on noticing a colour. */}
      <AppText
        style={[styles.meta, { color: unavailable ? theme.destructive : theme.mutedForeground }]}
      >
        {availability(reward)}
        {reward.totalRedemptionsUsed > 0 ? ` · claimed ${reward.totalRedemptionsUsed}×` : ''}
        {expires ? ` · expires ${expires}` : ''}
      </AppText>

      {/* FR-09: pooled progress, in numbers rather than a bar — the server owns the arithmetic. */}
      {reward.collaborative ? (
        <AppText style={[styles.meta, { color: theme.primary }]}>
          {reward.collaborative.funded
            ? 'Group goal reached'
            : `Group goal: ${reward.collaborative.pooled} of ${reward.collaborative.goal} pts`}
        </AppText>
      ) : null}

      {/* FR-14 — which rewards the children actually want is the most useful signal for a parent. */}
      {reward.wishlistCount ? (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          On {reward.wishlistCount} {reward.wishlistCount === 1 ? 'wishlist' : 'wishlists'}
        </AppText>
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
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Rewards</AppText>
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.destructive }]}>
            {failure instanceof NetworkError ? 'No connection' : 'Could not load rewards'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(failure)}
          </AppText>
        </Card>
        <Button label="Try again" onPress={refetchAll} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Rewards</AppText>
        <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>
          {loading ? 'Loading…' : `${rewards.length} in the shop`}
        </AppText>

        <View style={styles.headerAction}>
          <Button label="New reward" onPress={() => router.push('/(parent)/reward-form')} />
        </View>

        {actionError !== null && (
          <Card style={{ borderColor: theme.destructive }}>
            <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {actionError}
            </AppText>
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
            <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>
              {owed.length === 0 ? 'Nothing to hand over' : `You owe ${owed.length}`}
            </AppText>
            {owed.length === 0 ? (
              <Card>
                <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                  Every redeemed reward has been given out.
                </AppText>
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

            <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>The shop</AppText>
            {rewards.length === 0 ? (
              <Card>
                <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                  No rewards yet. Creating them is on the web for now.
                </AppText>
              </Card>
            ) : (
              rewards.map((reward) => (
                // Tapping edits it — the catalogue is the only route into the edit form.
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
  headerAction: { marginBottom: 12 },
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

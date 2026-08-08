/**
 * Avatar cosmetics.
 *
 * Bought with points earned from tasks; there is no real-money path here and there must never be one.
 *
 * Grouped by category because equipping is scoped to one: wearing a new hat takes the old hat off
 * automatically, and a flat list makes that look like the app randomly unequipped something. Owning and
 * wearing are shown as separate states for the same reason — taking an item off does not refund it, and
 * a child needs to see that it is still theirs.
 *
 * Artwork is not shipped yet, so items render as their name. `assetKey` is carried through the type so
 * swapping in images later is a rendering change and not a data one.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import {
  buyCosmetic,
  cosmeticsQuery,
  INVALIDATED_BY_COSMETIC_ACTION,
  setEquipped,
  type CosmeticRow,
} from '@/lib/cosmeticsApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function Item({
  item,
  busy,
  onBuy,
  onToggleEquip,
}: {
  item: CosmeticRow;
  busy: boolean;
  onBuy: () => void;
  onToggleEquip: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.item, { borderTopColor: theme.border }]}>
      <AppText style={[styles.name, { color: theme.cardForeground }]}>
        {item.name}
        {item.equipped ? ' — wearing' : item.owned ? ' — owned' : ''}
      </AppText>
      {item.description && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{item.description}</AppText>
      )}

      {item.owned ? (
        <View style={styles.actions}>
          <Button
            label={item.equipped ? 'Take off' : 'Wear it'}
            variant="secondary"
            onPress={onToggleEquip}
            disabled={busy}
          />
        </View>
      ) : (
        <>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            {item.pointsCost} points
            {item.affordable ? '' : ' — not enough yet'}
          </AppText>
          <View style={styles.actions}>
            <Button label="Buy" onPress={onBuy} disabled={busy || !item.affordable} />
          </View>
        </>
      )}
    </View>
  );
}

export default function Cosmetics() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, isPending, isError, refetch } = useQuery(cosmeticsQuery());

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_COSMETIC_ACTION.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setActingId(id);
      setActionError(null);
      try {
        await action();
        await invalidate();
      } catch (caught) {
        setActionError(describeError(caught));
      } finally {
        setActingId(null);
      }
    },
    [invalidate]
  );

  const { mutateAsync: doBuy } = useMutation({ mutationFn: buyCosmetic });
  const { mutateAsync: doEquip } = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setEquipped(id, on),
  });

  /** Grouped by category, because equipping is scoped to one. */
  const groups = useMemo(() => {
    const byCategory = new Map<string, CosmeticRow[]>();
    for (const item of data?.items ?? []) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    return [...byCategory.entries()];
  }, [data]);

  if (isPending) {
    return (
      <Screen>
        <BackLink label="Back to Me" href="/(child)/me" />
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <BackLink label="Back to Me" href="/(child)/me" />
        <Card>
          <AppText style={[styles.name, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your look'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackLink label="Back to Me" href="/(child)/me" />
      <ScrollView>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Your look
        </AppText>
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          {data.pointsBalance} points to spend
        </AppText>

        {actionError !== null && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
            <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {actionError}
            </AppText>
          </Card>
        )}

        {groups.length === 0 ? (
          <Card>
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              Nothing to buy yet.
            </AppText>
          </Card>
        ) : (
          groups.map(([category, items]) => (
            <Card key={category}>
              <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
                {category}
              </AppText>
              {items.map((item) => (
                <Item
                  key={item.id}
                  item={item}
                  busy={actingId === item.id}
                  onBuy={() => void runAction(item.id, () => doBuy(item.id))}
                  onToggleEquip={() =>
                    void runAction(item.id, () => doEquip({ id: item.id, on: !item.equipped }))
                  }
                />
              ))}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[1],
  },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  item: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  actions: { marginTop: spacing[2] },
  footer: { marginTop: spacing[4] },
});

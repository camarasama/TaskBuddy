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
 * Artwork is not shipped yet, so items render as their name beside their category's tile. `assetKey` is carried through the type so
 * swapping in images later is a rendering change and not a data one.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
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
import type { AccentTone } from '@/theme/accents';

/** Each category's tile. Unknown categories fall back to sparkles rather than breaking the list. */
const CATEGORY_TILE: Record<string, { icon: IoniconName; tone: AccentTone; label: string }> = {
  frame: { icon: 'scan-outline', tone: 'primary', label: 'Frames' },
  background: { icon: 'color-palette', tone: 'xp', label: 'Backgrounds' },
  hat: { icon: 'happy', tone: 'peach', label: 'Hats' },
};
const FALLBACK_TILE = { icon: 'sparkles' as IoniconName, tone: 'gold' as AccentTone };

function Item({
  item,
  first,
  busy,
  onBuy,
  onToggleEquip,
}: {
  item: CosmeticRow;
  first: boolean;
  busy: boolean;
  onBuy: () => void;
  onToggleEquip: () => void;
}) {
  const theme = useTheme();
  const tile = CATEGORY_TILE[item.category] ?? FALLBACK_TILE;

  return (
    <View style={[styles.item, { borderTopColor: theme.border }, first && styles.itemFirst]}>
      <View style={styles.itemRow}>
        <IconTile tone={tile.tone} icon={tile.icon} size={44} muted={!item.owned && !item.affordable} />
        <View style={styles.grow}>
          <AppText style={[styles.name, { color: theme.cardForeground }]}>{item.name}</AppText>
          {item.description && (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{item.description}</AppText>
          )}
          {/* Owning and wearing are separate states on purpose: taking something off does not refund it. */}
          <View style={styles.chips}>
            {item.equipped ? (
              <Chip compact variant="done" icon="checkmark-circle" label="Wearing" />
            ) : item.owned ? (
              <Chip compact variant="info" icon="bag-check" label="Owned" />
            ) : (
              <>
                <Chip compact variant="gold" icon="star" label={`${item.pointsCost} points`} />
                {!item.affordable && <Chip compact variant="pending" label="Not enough yet" />}
              </>
            )}
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        {item.owned ? (
          <Button
            label={item.equipped ? 'Take off' : 'Wear it'}
            variant={item.equipped ? 'secondary' : 'soft'}
            onPress={onToggleEquip}
            disabled={busy}
          />
        ) : (
          <Button label="Buy" onPress={onBuy} disabled={busy || !item.affordable} />
        )}
      </View>
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
        <Card status="late">
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
        <GradientHeader
          tone="peach"
          icon="shirt"
          eyebrow="Your look"
          title={`${data.pointsBalance} points to spend`}
          subtitle="Spend points on things to wear."
        />

        {actionError !== null && (
          <Card status="late">
            <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {actionError}
            </AppText>
          </Card>
        )}

        {groups.length === 0 ? (
          <EmptyState emoji="👕" title="Nothing to buy yet." />
        ) : (
          groups.map(([category, items]) => (
            <View key={category}>
              <SectionTitle
                title={CATEGORY_TILE[category]?.label ?? category}
                icon={(CATEGORY_TILE[category] ?? FALLBACK_TILE).icon}
                tone={(CATEGORY_TILE[category] ?? FALLBACK_TILE).tone}
              />
              <Card>
              {items.map((item, index) => (
                <Item
                  key={item.id}
                  item={item}
                  first={index === 0}
                  busy={actingId === item.id}
                  onBuy={() => void runAction(item.id, () => doBuy(item.id))}
                  onToggleEquip={() =>
                    void runAction(item.id, () => doEquip({ id: item.id, on: !item.equipped }))
                  }
                />
              ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  // The first row in a card has no rule above it; the rest are separated.
  item: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  itemFirst: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  actions: { marginTop: spacing[3] },
  footer: { marginTop: spacing[4] },
});

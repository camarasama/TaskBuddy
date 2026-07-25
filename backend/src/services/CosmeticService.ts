/**
 * services/CosmeticService.ts — avatar cosmetics as a points sink (growth roadmap §4.4).
 *
 * Why this exists: real-world rewards depend on a parent actually delivering something. When they
 * are slow — and they often are — points stop meaning anything and the whole loop stalls. Cosmetics
 * give points a use the child controls entirely, redeemable the instant they are earned.
 *
 * **Binding constraint (ethics guardrails): everything here is bought with in-app points earned from
 * tasks. There is no purchase path in the child experience and no real money anywhere in this file.**
 *
 * Spending mirrors `RewardService.redeemReward` exactly — decrement the profile and write a negative
 * `pointsLedger` row with `balanceAfter`, inside one transaction. Deliberately NOT a bespoke balance
 * write: the ledger is the audit trail for every point a child has ever earned or spent, and a
 * purchase that skipped it would make the balance unreconcilable.
 */

import { prisma } from './database';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler';

/** One item may be equipped per category. */
export const COSMETIC_CATEGORIES = ['frame', 'background', 'hat'] as const;
export type CosmeticCategory = (typeof COSMETIC_CATEGORIES)[number];

export interface CosmeticRow {
  id: string;
  category: string;
  name: string;
  description: string | null;
  assetKey: string;
  pointsCost: number;
  owned: boolean;
  equipped: boolean;
  /** False when the child cannot afford it yet — drives the UI without a second call. */
  affordable: boolean;
}

/**
 * The catalogue as this child sees it: every active item, annotated with what they own, what they
 * are wearing, and what they can afford right now.
 */
export async function listForChild(childId: string): Promise<{
  items: CosmeticRow[];
  pointsBalance: number;
}> {
  const [items, owned, profile] = await Promise.all([
    prisma.cosmeticItem.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { pointsCost: 'asc' }],
    }),
    prisma.childCosmetic.findMany({ where: { childId } }),
    prisma.childProfile.findUnique({
      where: { userId: childId },
      select: { pointsBalance: true },
    }),
  ]);

  const pointsBalance = profile?.pointsBalance ?? 0;
  const ownedById = new Map(owned.map((o) => [o.itemId, o]));

  return {
    pointsBalance,
    items: items.map((item) => {
      const record = ownedById.get(item.id);
      return {
        id: item.id,
        category: item.category,
        name: item.name,
        description: item.description,
        assetKey: item.assetKey,
        pointsCost: item.pointsCost,
        owned: Boolean(record),
        equipped: record?.isEquipped ?? false,
        affordable: pointsBalance >= item.pointsCost,
      };
    }),
  };
}

/** What the child is currently wearing, for rendering the avatar. */
export async function getEquipped(childId: string): Promise<Record<string, string>> {
  const equipped = await prisma.childCosmetic.findMany({
    where: { childId, isEquipped: true },
    include: { item: true },
  });
  return Object.fromEntries(equipped.map((e) => [e.item.category, e.item.assetKey]));
}

/**
 * Buy an item with points.
 *
 * Atomic: ownership, the balance decrement and the ledger row all land together, so a failure can
 * never charge a child for something they do not own or hand them something free.
 *
 * The newly bought item is equipped immediately — a child who just spent points expects to see the
 * result, and making them tap again is friction for no benefit.
 */
export async function purchase(params: {
  childId: string;
  itemId: string;
}): Promise<{ itemId: string; pointsSpent: number; newBalance: number }> {
  const { childId, itemId } = params;

  const item = await prisma.cosmeticItem.findFirst({ where: { id: itemId, isActive: true } });
  if (!item) throw new NotFoundError('That item is not available');

  const alreadyOwned = await prisma.childCosmetic.findUnique({
    where: { childId_itemId: { childId, itemId } },
  });
  if (alreadyOwned) throw new ConflictError('You already own this one.');

  const profile = await prisma.childProfile.findUnique({
    where: { userId: childId },
    select: { pointsBalance: true },
  });
  if (!profile) throw new NotFoundError('Child profile not found');

  if (profile.pointsBalance < item.pointsCost) {
    const short = item.pointsCost - profile.pointsBalance;
    throw new ValidationError(`You need ${short} more point${short === 1 ? '' : 's'} for this.`);
  }

  return prisma.$transaction(async (tx) => {
    const newBalance = profile.pointsBalance - item.pointsCost;

    // Clear the category first, so the new item can be worn straight away without ever leaving two
    // equipped in the same slot — even briefly.
    await tx.childCosmetic.updateMany({
      where: { childId, isEquipped: true, item: { category: item.category } },
      data: { isEquipped: false },
    });

    await tx.childCosmetic.create({
      data: { childId, itemId, isEquipped: true },
    });

    await tx.childProfile.update({
      where: { userId: childId },
      data: { pointsBalance: newBalance },
    });

    // Same shape as a reward redemption: negative amount, balanceAfter, reference to the source.
    await tx.pointsLedger.create({
      data: {
        childId,
        transactionType: 'redeemed',
        pointsAmount: -item.pointsCost,
        balanceAfter: newBalance,
        referenceType: 'cosmetic_item',
        referenceId: item.id,
        description: `Unlocked: ${item.name}`,
      },
    });

    return { itemId, pointsSpent: item.pointsCost, newBalance };
  });
}

/**
 * Wear an owned item, replacing whatever occupied that category.
 *
 * Owning and wearing are separate: a child keeps everything they bought and swaps freely. "At most
 * one equipped per (child, category)" is not expressible as a unique index, so the clear-then-set
 * happens in one transaction and that pairing IS the constraint.
 */
export async function equip(params: { childId: string; itemId: string }): Promise<void> {
  const { childId, itemId } = params;

  const record = await prisma.childCosmetic.findUnique({
    where: { childId_itemId: { childId, itemId } },
    include: { item: true },
  });
  if (!record) throw new NotFoundError('You do not own that item');

  await prisma.$transaction(async (tx) => {
    await tx.childCosmetic.updateMany({
      where: { childId, isEquipped: true, item: { category: record.item.category } },
      data: { isEquipped: false },
    });
    await tx.childCosmetic.update({
      where: { id: record.id },
      data: { isEquipped: true },
    });
  });
}

/** Take an item off. Ownership is untouched — a child never loses what they paid for. */
export async function unequip(params: { childId: string; itemId: string }): Promise<void> {
  const { childId, itemId } = params;
  await prisma.childCosmetic.updateMany({
    where: { childId, itemId, isEquipped: true },
    data: { isEquipped: false },
  });
}

export const CosmeticService = { listForChild, getEquipped, purchase, equip, unequip };

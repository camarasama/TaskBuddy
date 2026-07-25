/**
 * U8 — avatar cosmetics as a points sink (growth roadmap §4.4).
 *
 * Why it exists: real-world rewards depend on a parent actually delivering something, and when they
 * are slow, points stop meaning anything. Cosmetics give points a use the child controls entirely.
 *
 * The properties under test are the ones that would cost a child real earned points if wrong:
 *  - a purchase is ATOMIC and goes through the points ledger, never a bespoke balance write;
 *  - it is refused when unaffordable, and refused twice for the same item;
 *  - owning and wearing are separate, and a category never holds two equipped items;
 *  - **no real-money path exists anywhere in this feature** (ethics guardrails).
 */

jest.mock('../src/services/database', () => {
  const tx = {
    childCosmetic: { updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    childProfile: { update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  };
  return {
    prisma: {
      cosmeticItem: { findFirst: jest.fn(), findMany: jest.fn() },
      childCosmetic: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      childProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { COSMETIC_CATEGORIES, CosmeticService } from '../src/services/CosmeticService';
import { COSMETIC_SEED } from '../src/routes/cosmeticsSeed';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  cosmeticItem: { findFirst: jest.Mock; findMany: jest.Mock };
  childCosmetic: { findUnique: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  __tx: {
    childCosmetic: { updateMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    childProfile: { update: jest.Mock };
    pointsLedger: { create: jest.Mock };
  };
};

const CHILD = 'child-1';
const ITEM = 'item-1';

const crown = { id: ITEM, category: 'hat', name: 'Crown', assetKey: 'hat-crown', pointsCost: 320, isActive: true };

beforeEach(() => {
  jest.clearAllMocks();
  p.cosmeticItem.findFirst.mockResolvedValue(crown);
  p.childCosmetic.findUnique.mockResolvedValue(null);
  p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 500 });
  p.__tx.childCosmetic.create.mockResolvedValue({ id: 'owned-1' });
});

// ─── The catalogue (AC-U8a, AC-U8e) ───────────────────────────────────────────

describe('seed catalogue', () => {
  it('ships 20 items', () => {
    expect(COSMETIC_SEED).toHaveLength(20);
  });

  it('covers every declared category', () => {
    const categories = new Set(COSMETIC_SEED.map((i) => i.category));
    for (const c of COSMETIC_CATEGORIES) expect(categories.has(c)).toBe(true);
  });

  it('spans a real price range, so the sink keeps working past week one', () => {
    // Only-expensive is not a sink; only-cheap stops mattering almost immediately.
    const costs = COSMETIC_SEED.map((i) => i.pointsCost);
    expect(Math.min(...costs)).toBeLessThanOrEqual(30);
    expect(Math.max(...costs)).toBeGreaterThanOrEqual(300);
  });

  it('has a unique assetKey within each category — that pairing is the DB constraint', () => {
    const seen = new Set<string>();
    for (const item of COSMETIC_SEED) {
      const key = `${item.category}::${item.assetKey}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('prices everything in POINTS only — no currency field exists anywhere', () => {
    // Binding under the ethics guardrails: no purchase path in the child experience.
    for (const item of COSMETIC_SEED) {
      expect(typeof item.pointsCost).toBe('number');
      expect(Object.keys(item)).not.toContain('price');
      expect(Object.keys(item)).not.toContain('currency');
    }
  });
});

// ─── Purchase (AC-U8b, AC-U8c) ────────────────────────────────────────────────

describe('purchase', () => {
  it('writes a NEGATIVE points-ledger row with balanceAfter, like a reward redemption', async () => {
    // The ledger is the audit trail for every point ever earned or spent. A purchase that skipped it
    // would leave the balance unreconcilable.
    await CosmeticService.purchase({ childId: CHILD, itemId: ITEM });

    expect(p.__tx.pointsLedger.create.mock.calls[0][0].data).toMatchObject({
      childId: CHILD,
      transactionType: 'redeemed',
      pointsAmount: -320,
      balanceAfter: 180,
      referenceType: 'cosmetic_item',
      referenceId: ITEM,
    });
  });

  it('decrements the balance by exactly the cost', async () => {
    await CosmeticService.purchase({ childId: CHILD, itemId: ITEM });
    expect(p.__tx.childProfile.update.mock.calls[0][0].data).toEqual({ pointsBalance: 180 });
  });

  it('does ownership, balance and ledger in ONE transaction', async () => {
    // A partial failure must never charge a child for something they do not own.
    await CosmeticService.purchase({ childId: CHILD, itemId: ITEM });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses when the child cannot afford it, and says how short they are', async () => {
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 300 });
    await expect(CosmeticService.purchase({ childId: CHILD, itemId: ITEM })).rejects.toThrow(
      /need 20 more points/i,
    );
  });

  it('uses singular grammar when one point short', async () => {
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 319 });
    await expect(CosmeticService.purchase({ childId: CHILD, itemId: ITEM })).rejects.toThrow(
      /1 more point\b/i,
    );
  });

  it('refuses a second purchase of the same item', async () => {
    p.childCosmetic.findUnique.mockResolvedValue({ id: 'owned-1' });
    await expect(CosmeticService.purchase({ childId: CHILD, itemId: ITEM })).rejects.toThrow(
      /already own/i,
    );
  });

  it('charges nothing when the purchase is refused', async () => {
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 10 });
    await expect(CosmeticService.purchase({ childId: CHILD, itemId: ITEM })).rejects.toThrow();
    expect(p.__tx.childProfile.update).not.toHaveBeenCalled();
    expect(p.__tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('404s for an inactive or unknown item', async () => {
    p.cosmeticItem.findFirst.mockResolvedValue(null);
    await expect(CosmeticService.purchase({ childId: CHILD, itemId: ITEM })).rejects.toThrow(
      /not available/i,
    );
  });

  it('equips the new item straight away, clearing the category first', async () => {
    // A child who just spent points expects to see the result; the clear-first ordering means the
    // category never holds two equipped items, not even briefly.
    await CosmeticService.purchase({ childId: CHILD, itemId: ITEM });

    expect(p.__tx.childCosmetic.updateMany.mock.calls[0][0].where).toMatchObject({
      childId: CHILD,
      isEquipped: true,
      item: { category: 'hat' },
    });
    expect(p.__tx.childCosmetic.create.mock.calls[0][0].data).toMatchObject({ isEquipped: true });
  });
});

// ─── Equip / unequip (AC-U8d) ─────────────────────────────────────────────────

describe('equip', () => {
  it('clears the category then sets the new one, in one transaction', async () => {
    // "At most one equipped per (child, category)" is not expressible as a unique index, so this
    // pairing IS the constraint.
    p.childCosmetic.findUnique.mockResolvedValue({
      id: 'owned-1',
      item: { category: 'frame' },
    });

    await CosmeticService.equip({ childId: CHILD, itemId: ITEM });

    expect(p.__tx.childCosmetic.updateMany.mock.calls[0][0].data).toEqual({ isEquipped: false });
    expect(p.__tx.childCosmetic.update.mock.calls[0][0].data).toEqual({ isEquipped: true });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to equip something the child does not own', async () => {
    p.childCosmetic.findUnique.mockResolvedValue(null);
    await expect(CosmeticService.equip({ childId: CHILD, itemId: ITEM })).rejects.toThrow(
      /do not own/i,
    );
  });
});

describe('unequip', () => {
  it('takes the item off WITHOUT touching ownership', async () => {
    // A child never loses what they paid for.
    await CosmeticService.unequip({ childId: CHILD, itemId: ITEM });
    expect(p.childCosmetic.updateMany).toHaveBeenCalledWith({
      where: { childId: CHILD, itemId: ITEM, isEquipped: true },
      data: { isEquipped: false },
    });
  });
});

// ─── Catalogue view ───────────────────────────────────────────────────────────

describe('listForChild', () => {
  it('annotates owned, equipped and affordable', async () => {
    p.cosmeticItem.findMany.mockResolvedValue([
      crown,
      { id: 'item-2', category: 'frame', name: 'Gold Ring', assetKey: 'frame-gold', pointsCost: 900 },
    ]);
    p.childCosmetic.findMany.mockResolvedValue([{ itemId: ITEM, isEquipped: true }]);
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 500 });

    const { items, pointsBalance } = await CosmeticService.listForChild(CHILD);

    expect(pointsBalance).toBe(500);
    expect(items[0]).toMatchObject({ owned: true, equipped: true, affordable: true });
    expect(items[1]).toMatchObject({ owned: false, equipped: false, affordable: false });
  });

  it('treats a child with no profile as having no points rather than crashing', async () => {
    p.cosmeticItem.findMany.mockResolvedValue([crown]);
    p.childCosmetic.findMany.mockResolvedValue([]);
    p.childProfile.findUnique.mockResolvedValue(null);

    const { pointsBalance, items } = await CosmeticService.listForChild(CHILD);
    expect(pointsBalance).toBe(0);
    expect(items[0].affordable).toBe(false);
  });
});

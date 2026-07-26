/**
 * U19 — ranking the reward presets by redemption data (growth roadmap §6).
 *
 * The ranking itself is arithmetic. The test that actually matters is the privacy one.
 *
 * Global popularity is computed over SYSTEM PRESET NAMES ONLY. Family reward names are free text and
 * routinely personal — "Trip to see Grandma Rose", "Sleepover at the Okonkwos'" — and counting those
 * across families would aggregate identifiable detail about real people into a signal shown to
 * strangers. The filter is an allow-list built from the shipped presets, not a blocklist, because a
 * blocklist fails open the moment someone writes a reward nobody anticipated.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    rewardRedemption: { findMany: jest.fn() },
    reward: { findMany: jest.fn() },
  },
}));

import {
  rankPresets,
  scoreOf,
  suggestRewards,
} from '../src/services/RewardSuggestionService';
import { REWARD_PRESETS } from '../src/routes/templatesSeed';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  rewardRedemption: { findMany: jest.Mock };
  reward: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';
const FILM = 'Pick the family film';
const SCREEN = 'Extra 30 minutes screen time';
const BOOK = 'A new book of your choice';

const empty = { familyRedemptionNames: [], globalRedemptionNames: [], existingNames: [] };

beforeEach(() => {
  jest.clearAllMocks();
  p.rewardRedemption.findMany.mockResolvedValue([]);
  p.reward.findMany.mockResolvedValue([]);
});

// ─── AC-U19c: the privacy property ────────────────────────────────────────────

describe('what may enter the global aggregate', () => {
  it('NEVER counts a custom family reward name', () => {
    // The whole point. These names describe real people and real homes; they must not become a
    // popularity signal shown to other families.
    const ranked = rankPresets({
      ...empty,
      globalRedemptionNames: [
        'Trip to see Grandma Rose',
        "Sleepover at the Okonkwos'",
        'Ice cream with Dad on Sundays',
      ],
    });

    expect(ranked.every((r) => r.popularity === 0)).toBe(true);
  });

  it('counts a shipped preset name', () => {
    const ranked = rankPresets({ ...empty, globalRedemptionNames: [FILM, FILM] });
    expect(ranked.find((r) => r.name === FILM)!.popularity).toBe(2);
  });

  it('uses an ALLOW-list, so an unanticipated name is excluded by default', () => {
    // A blocklist would fail open here; an allow-list fails closed, which is the correct direction
    // for something that leaves the family.
    const ranked = rankPresets({
      ...empty,
      globalRedemptionNames: ['Extra 30 minutes screen time on the new tablet Nana bought'],
    });
    expect(ranked.every((r) => r.popularity === 0)).toBe(true);
  });

  it('still matches a preset despite casing and stray whitespace', () => {
    const ranked = rankPresets({ ...empty, globalRedemptionNames: ['  pick THE family FILM '] });
    expect(ranked.find((r) => r.name === FILM)!.popularity).toBe(1);
  });

  // AC-U19f
  it('returns nothing beyond the preset fields and the three counts', () => {
    const ranked = rankPresets({
      familyRedemptionNames: [FILM],
      globalRedemptionNames: [FILM],
      existingNames: [FILM],
    });

    expect(Object.keys(ranked[0]).sort()).toEqual([
      'alreadyAdded', 'description', 'familyRedemptions', 'name', 'pointsCost', 'popularity', 'tier',
    ].sort());
    // And no internal sort key leaks out.
    expect(ranked[0]).not.toHaveProperty('shippedOrder');
  });
});

// ─── AC-U19b: the ranking rule ────────────────────────────────────────────────

describe('ranking', () => {
  it("puts this family's own history above the crowd's", () => {
    // What these children redeem predicts this family better than what strangers redeem — and it is
    // the part a parent can verify from memory.
    const ranked = rankPresets({
      familyRedemptionNames: [BOOK],
      globalRedemptionNames: Array(5).fill(FILM),
      existingNames: [],
    });

    expect(ranked[0].name).toBe(BOOK);
  });

  it('lets a large enough crowd signal outrank a single family redemption', () => {
    // Family weight is 10, not infinity: one redemption should not pin a preset to the top forever.
    const ranked = rankPresets({
      familyRedemptionNames: [BOOK],
      globalRedemptionNames: Array(20).fill(FILM),
      existingNames: [],
    });

    expect(ranked[0].name).toBe(FILM);
  });

  it('orders by score', () => {
    const ranked = rankPresets({
      familyRedemptionNames: [SCREEN, SCREEN],
      globalRedemptionNames: [FILM, FILM, FILM],
      existingNames: [],
    });

    const scores = ranked.map(scoreOf);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  // AC-U19g
  it('is deterministic — equal scores keep the shipped order', () => {
    // A picker that reorders itself on refresh feels broken.
    const first = rankPresets(empty).map((r) => r.name);
    const second = rankPresets(empty).map((r) => r.name);

    expect(first).toEqual(second);
    expect(first).toEqual(REWARD_PRESETS.map((r) => r.name));
  });

  // AC-U19d
  it('returns every preset even with no data anywhere', () => {
    // Degrades to today's behaviour, never to a blank picker.
    expect(rankPresets(empty)).toHaveLength(REWARD_PRESETS.length);
  });

  // AC-U19e
  it('flags a reward the family already has WITHOUT hiding it', () => {
    // Re-creating one is usually a mistake but occasionally deliberate — a second, pricier tier.
    const ranked = rankPresets({ ...empty, existingNames: [FILM] });
    const film = ranked.find((r) => r.name === FILM)!;

    expect(film.alreadyAdded).toBe(true);
    expect(ranked).toHaveLength(REWARD_PRESETS.length);
  });

  it('does not flag presets the family has not added', () => {
    const ranked = rankPresets({ ...empty, existingNames: [FILM] });
    expect(ranked.filter((r) => r.alreadyAdded)).toHaveLength(1);
  });
});

// ─── The database-backed path ─────────────────────────────────────────────────

describe('suggestRewards', () => {
  it('scopes the family query to the family and the global query to nothing else', async () => {
    await suggestRewards(FAMILY);

    const [familyCall, globalCall] = p.rewardRedemption.findMany.mock.calls;
    expect(familyCall[0].where).toEqual({ reward: { familyId: FAMILY } });
    // The global read has no where clause, and selects only the name — no child id, no family id,
    // no timestamp.
    expect(globalCall[0].where).toBeUndefined();
    expect(globalCall[0].select).toEqual({ reward: { select: { name: true } } });
  });

  it('bounds the global read rather than scanning every redemption ever', async () => {
    await suggestRewards(FAMILY);
    expect(p.rewardRedemption.findMany.mock.calls[1][0].take).toBe(10_000);
  });

  it('ranks from the queried data', async () => {
    p.rewardRedemption.findMany
      .mockResolvedValueOnce([{ reward: { name: BOOK } }])          // family
      .mockResolvedValueOnce([{ reward: { name: FILM } }]);          // global
    p.reward.findMany.mockResolvedValue([{ name: SCREEN }]);

    const ranked = await suggestRewards(FAMILY);
    expect(ranked[0].name).toBe(BOOK);
    expect(ranked.find((r) => r.name === SCREEN)!.alreadyAdded).toBe(true);
  });

  it('falls back to the shipped order when the query fails', async () => {
    // A ranking hint is not worth failing a page load over.
    p.rewardRedemption.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ranked = await suggestRewards(FAMILY);
    expect(ranked.map((r) => r.name)).toEqual(REWARD_PRESETS.map((r) => r.name));
    jest.restoreAllMocks();
  });
});

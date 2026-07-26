/**
 * services/RewardSuggestionService.ts — ranking the reward presets (growth roadmap §6).
 *
 * The preset picker has shipped the same ten rewards in the order I happened to type them. This
 * ranks them by what families actually redeem.
 *
 * **The privacy decision is the important one.** Global popularity is computed over SYSTEM PRESET
 * NAMES ONLY. A family's own reward names are free text and routinely personal — "Trip to see
 * Grandma Rose", "Sleepover at the Okonkwos'" — and counting those across families would aggregate
 * identifiable detail about real people into a signal shown to strangers. A preset name is content
 * we wrote and shipped to everyone, so counting its redemptions discloses nothing about anyone. That
 * is enforced by matching against the shipped list rather than by excluding a blocklist, because a
 * blocklist fails open the moment someone adds a reward nobody thought of.
 *
 * **A family's own history outranks the crowd.** What these children redeem predicts this family
 * better than what strangers redeem, and it is the part a parent can check against their own memory
 * — which is what makes the ordering feel earned rather than arbitrary.
 */

import { prisma } from './database';
import { REWARD_PRESETS, type RewardPreset } from '../routes/templatesSeed';

export interface RankedRewardPreset extends RewardPreset {
  /** Times THIS family has redeemed a reward of this name. The strongest signal. */
  familyRedemptions: number;
  /** Times any family has redeemed a preset of this name. Preset names only — never custom ones. */
  popularity: number;
  /** The family already has an active reward with this name. Flagged, not hidden. */
  alreadyAdded: boolean;
}

/**
 * A family redemption is worth far more than a stranger's, but not infinitely more — otherwise one
 * redemption would permanently pin a preset to the top regardless of anything else.
 */
const FAMILY_WEIGHT = 10;

/** Case- and whitespace-insensitive, so "Pick The Family Film " matches the shipped preset. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/** The shipped preset names, for deciding what may enter the global aggregate. */
const PRESET_NAMES: ReadonlySet<string> = new Set(REWARD_PRESETS.map((p) => normalise(p.name)));

export function scoreOf(preset: RankedRewardPreset): number {
  return preset.familyRedemptions * FAMILY_WEIGHT + preset.popularity;
}

/**
 * Order the presets for one family.
 *
 * Pure, so the ranking rule can be tested without a database — including the property that matters
 * most, which is that a custom reward name can never contribute to the global count.
 */
export function rankPresets(params: {
  /** Redeemed reward names for THIS family, one entry per redemption. May include custom names. */
  familyRedemptionNames: string[];
  /** Redeemed reward names across all families, one entry per redemption. Filtered here. */
  globalRedemptionNames: string[];
  /** Active reward names the family already has. */
  existingNames: string[];
}): RankedRewardPreset[] {
  const familyCounts = new Map<string, number>();
  for (const name of params.familyRedemptionNames) {
    const key = normalise(name);
    familyCounts.set(key, (familyCounts.get(key) ?? 0) + 1);
  }

  const globalCounts = new Map<string, number>();
  for (const name of params.globalRedemptionNames) {
    const key = normalise(name);
    // The gate. A name that is not one we shipped never reaches the aggregate, whatever it says.
    if (!PRESET_NAMES.has(key)) continue;
    globalCounts.set(key, (globalCounts.get(key) ?? 0) + 1);
  }

  const existing = new Set(params.existingNames.map(normalise));

  const ranked = REWARD_PRESETS.map((preset, shippedOrder) => {
    const key = normalise(preset.name);
    return {
      ...preset,
      familyRedemptions: familyCounts.get(key) ?? 0,
      popularity: globalCounts.get(key) ?? 0,
      alreadyAdded: existing.has(key),
      shippedOrder,
    };
  });

  return ranked
    .sort((a, b) => {
      const diff = scoreOf(b) - scoreOf(a);
      // Ties fall back to the shipped order, so equal scores never shuffle between requests — a
      // picker that reorders itself on refresh feels broken.
      return diff !== 0 ? diff : a.shippedOrder - b.shippedOrder;
    })
    .map(({ shippedOrder: _shippedOrder, ...rest }) => rest);
}

/** Build the ranked list for a family. Falls back to the shipped order if anything goes wrong. */
export async function suggestRewards(familyId: string): Promise<RankedRewardPreset[]> {
  try {
    const [familyRedemptions, globalRedemptions, existing] = await Promise.all([
      prisma.rewardRedemption.findMany({
        where: { reward: { familyId } },
        select: { reward: { select: { name: true } } },
      }),
      // Every family's redemptions, but only the NAME travels, and only preset names survive the
      // filter in rankPresets. No family id, child id or timestamp is read here at all.
      prisma.rewardRedemption.findMany({
        select: { reward: { select: { name: true } } },
        take: 10_000, // bounded: this is a popularity hint, not an audit
      }),
      prisma.reward.findMany({
        where: { familyId, isActive: true },
        select: { name: true },
      }),
    ]);

    return rankPresets({
      familyRedemptionNames: familyRedemptions.map((r) => r.reward.name),
      globalRedemptionNames: globalRedemptions.map((r) => r.reward.name),
      existingNames: existing.map((r) => r.name),
    });
  } catch (error) {
    console.warn('[RewardSuggestionService] ranking failed; shipped order:', (error as Error)?.message);
    return rankPresets({ familyRedemptionNames: [], globalRedemptionNames: [], existingNames: [] });
  }
}

export const RewardSuggestionService = { suggestRewards, rankPresets, scoreOf };

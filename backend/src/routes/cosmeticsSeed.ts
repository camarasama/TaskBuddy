/**
 * cosmeticsSeed.ts — the starter cosmetics catalogue (growth roadmap §4.4).
 *
 * Twenty items across three categories, priced so the cheapest is reachable after a couple of tasks
 * and the dearest is a genuine save. That spread is the point: a sink with only expensive items is
 * not a sink, and one with only cheap items stops mattering within a week.
 *
 * `assetKey` is a renderer key the frontend maps to CSS/SVG — no art in the database, and a redesign
 * never needs a migration.
 *
 * Idempotent by (category, assetKey), which is also the table's unique constraint, so a redeploy
 * neither duplicates nor overwrites a price an admin has changed.
 */
import { prisma } from '../services/database';

export interface SeedCosmetic {
  category: 'frame' | 'background' | 'hat';
  name: string;
  description: string;
  assetKey: string;
  pointsCost: number;
}

export const COSMETIC_SEED: SeedCosmetic[] = [
  // ── Frames — a ring around the avatar ──────────────────────────────────────
  { category: 'frame', name: 'Bronze Ring', description: 'A simple bronze circle.', assetKey: 'frame-bronze', pointsCost: 30 },
  { category: 'frame', name: 'Silver Ring', description: 'Polished and bright.', assetKey: 'frame-silver', pointsCost: 80 },
  { category: 'frame', name: 'Gold Ring', description: 'You have clearly been busy.', assetKey: 'frame-gold', pointsCost: 200 },
  { category: 'frame', name: 'Rainbow', description: 'Every colour at once.', assetKey: 'frame-rainbow', pointsCost: 250 },
  { category: 'frame', name: 'Starlight', description: 'Tiny stars, slowly turning.', assetKey: 'frame-starlight', pointsCost: 300 },
  { category: 'frame', name: 'Flames', description: 'For the streak keepers.', assetKey: 'frame-flames', pointsCost: 400 },
  { category: 'frame', name: 'Leaves', description: 'A ring of green leaves.', assetKey: 'frame-leaves', pointsCost: 120 },

  // ── Backgrounds — behind the avatar ────────────────────────────────────────
  { category: 'background', name: 'Sky Blue', description: 'A clear day.', assetKey: 'bg-sky', pointsCost: 25 },
  { category: 'background', name: 'Sunset', description: 'Orange fading to pink.', assetKey: 'bg-sunset', pointsCost: 90 },
  { category: 'background', name: 'Deep Space', description: 'Stars, and a lot of dark.', assetKey: 'bg-space', pointsCost: 220 },
  { category: 'background', name: 'Forest', description: 'Green and quiet.', assetKey: 'bg-forest', pointsCost: 110 },
  { category: 'background', name: 'Ocean', description: 'Waves all the way down.', assetKey: 'bg-ocean', pointsCost: 140 },
  { category: 'background', name: 'Confetti', description: 'Permanently celebrating.', assetKey: 'bg-confetti', pointsCost: 280 },
  { category: 'background', name: 'Aurora', description: 'Green and violet light.', assetKey: 'bg-aurora', pointsCost: 350 },

  // ── Hats — on top of the avatar ────────────────────────────────────────────
  { category: 'hat', name: 'Cap', description: 'Worn backwards, obviously.', assetKey: 'hat-cap', pointsCost: 40 },
  { category: 'hat', name: 'Party Hat', description: 'For no particular reason.', assetKey: 'hat-party', pointsCost: 60 },
  { category: 'hat', name: 'Crown', description: 'Earned, not inherited.', assetKey: 'hat-crown', pointsCost: 320 },
  { category: 'hat', name: 'Wizard Hat', description: 'Slightly too big.', assetKey: 'hat-wizard', pointsCost: 180 },
  { category: 'hat', name: 'Space Helmet', description: 'Sealed and shiny.', assetKey: 'hat-helmet', pointsCost: 260 },
  { category: 'hat', name: 'Woolly Hat', description: 'Warm. Slightly itchy.', assetKey: 'hat-woolly', pointsCost: 70 },
];

export async function seedCosmetics(): Promise<void> {
  for (const item of COSMETIC_SEED) {
    const existing = await prisma.cosmeticItem.findFirst({
      where: { category: item.category, assetKey: item.assetKey },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.cosmeticItem.create({ data: item });
  }
  console.log(`[Cosmetics] Seeded catalogue (${COSMETIC_SEED.length} items).`);
}

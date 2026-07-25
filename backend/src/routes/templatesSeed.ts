/**
 * templatesSeed.ts — system task templates and reward presets (growth roadmap §3.1).
 *
 * Cold-start is the roadmap's biggest identified drop-off: a blank task list demands creative effort
 * from a parent at the exact moment they have least patience. These are the starter content.
 *
 * Two different storage choices, deliberately:
 *
 *  - **Task templates live in the DB** (`task_templates`, `familyId = null`, `isSystemTemplate`).
 *    The model already existed for family-authored templates, so system ones share it and a future
 *    admin editor works on both — the same shape as `/admin/games`.
 *  - **Reward presets are code constants.** They are static starter content copied into a family's
 *    own Reward on pick; there is no per-family reward-template authoring in scope, so a table and a
 *    migration for ten fixed rows would be weight without benefit.
 *
 * Safe to re-run: seeding skips templates whose (category, name) already exists, so it never
 * clobbers an edit and never duplicates on redeploy.
 */
import { prisma } from '../services/database';

export interface SystemTemplate {
  name: string;
  description: string;
  /** Doubles as the pack name — packs are just a category grouping. */
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  suggestedPoints: number;
  estimatedMinutes: number;
  /** '10-12' | '13-16' | null (all ages). Parsed by isAgeAppropriate. */
  ageRange: string | null;
  requiresPhotoEvidence: boolean;
}

/**
 * Packs, in the order they should be offered. Five packs, 32 templates.
 * Points scale with effort, not age — a 13-year-old doing an easy task earns the easy rate.
 */
export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  // ── Morning Routine (all ages) ────────────────────────────────────────────
  { name: 'Make your bed', description: 'Straighten the covers and arrange the pillows.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 5, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Brush teeth', description: 'Two minutes, morning and night.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 3, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Get dressed on time', description: 'Ready to go before the agreed time.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 10, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Pack your school bag', description: 'Books, homework and kit — checked the night before counts double.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 10, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Eat breakfast without reminders', description: 'Sit down and finish breakfast on your own.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Put pyjamas away', description: 'Folded and in the drawer, not on the floor.', category: 'Morning Routine', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 3, ageRange: null, requiresPhotoEvidence: false },

  // ── School Week ───────────────────────────────────────────────────────────
  { name: 'Finish homework before dinner', description: 'All of it, before the evening starts.', category: 'School Week', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 45, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Read for 20 minutes', description: 'Any book you like.', category: 'School Week', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 20, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Practise spellings', description: 'Ten words, out loud or written.', category: 'School Week', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 15, ageRange: '10-12', requiresPhotoEvidence: false },
  { name: 'Review today’s notes', description: 'Ten minutes going back over what you covered.', category: 'School Week', difficulty: 'medium', suggestedPoints: 15, estimatedMinutes: 15, ageRange: '13-16', requiresPhotoEvidence: false },
  { name: 'Lay out tomorrow’s uniform', description: 'Everything ready so the morning is calm.', category: 'School Week', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 5, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Charge and pack your devices', description: 'Laptop or tablet charged and in the bag.', category: 'School Week', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 5, ageRange: '13-16', requiresPhotoEvidence: false },
  { name: 'Plan the week ahead', description: 'Write down what is due and when.', category: 'School Week', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 20, ageRange: '13-16', requiresPhotoEvidence: true },

  // ── Kitchen Helper ────────────────────────────────────────────────────────
  { name: 'Lay the table', description: 'Plates, cutlery and glasses for everyone.', category: 'Kitchen Helper', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 10, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Clear the table', description: 'Everything back to the kitchen after the meal.', category: 'Kitchen Helper', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 10, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Load the dishwasher', description: 'Stacked properly so it actually cleans.', category: 'Kitchen Helper', difficulty: 'medium', suggestedPoints: 15, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Empty the dishwasher', description: 'Everything back where it belongs.', category: 'Kitchen Helper', difficulty: 'medium', suggestedPoints: 15, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Wipe the kitchen counters', description: 'Clear them first, then wipe.', category: 'Kitchen Helper', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 10, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Help cook a meal', description: 'Chop, stir or measure — with a grown-up.', category: 'Kitchen Helper', difficulty: 'hard', suggestedPoints: 30, estimatedMinutes: 45, ageRange: '13-16', requiresPhotoEvidence: true },
  { name: 'Make your own packed lunch', description: 'Something balanced, made the night before.', category: 'Kitchen Helper', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 20, ageRange: '13-16', requiresPhotoEvidence: true },

  // ── Pet Care ──────────────────────────────────────────────────────────────
  { name: 'Feed the pet', description: 'The right amount, at the right time.', category: 'Pet Care', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 5, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Fresh water for the pet', description: 'Empty, rinse and refill the bowl.', category: 'Pet Care', difficulty: 'easy', suggestedPoints: 5, estimatedMinutes: 5, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Walk the dog', description: 'A proper walk, not just the garden.', category: 'Pet Care', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 30, ageRange: '13-16', requiresPhotoEvidence: true },
  { name: 'Clean the litter tray or cage', description: 'Gloves on, all of it, then wash your hands.', category: 'Pet Care', difficulty: 'hard', suggestedPoints: 25, estimatedMinutes: 20, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Brush the pet', description: 'A gentle brush all over.', category: 'Pet Care', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: false },
  { name: 'Play with the pet', description: 'Fifteen minutes of proper attention.', category: 'Pet Care', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: false },

  // ── Weekend Reset ─────────────────────────────────────────────────────────
  { name: 'Tidy your room', description: 'Floor clear, surfaces clear, everything put away.', category: 'Weekend Reset', difficulty: 'medium', suggestedPoints: 25, estimatedMinutes: 30, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Change your bed sheets', description: 'Old ones to the wash, fresh ones on.', category: 'Weekend Reset', difficulty: 'hard', suggestedPoints: 30, estimatedMinutes: 25, ageRange: '13-16', requiresPhotoEvidence: true },
  { name: 'Put your laundry away', description: 'Folded and in drawers, not on the chair.', category: 'Weekend Reset', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 20, ageRange: null, requiresPhotoEvidence: true },
  { name: 'Hoover your room', description: 'Under the bed too.', category: 'Weekend Reset', difficulty: 'medium', suggestedPoints: 20, estimatedMinutes: 20, ageRange: '13-16', requiresPhotoEvidence: true },
  { name: 'Take the bins out', description: 'Both bins, out to the kerb.', category: 'Weekend Reset', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 10, ageRange: '13-16', requiresPhotoEvidence: false },
  { name: 'Sort out your school bag', description: 'Empty it, bin the rubbish, repack it.', category: 'Weekend Reset', difficulty: 'easy', suggestedPoints: 10, estimatedMinutes: 15, ageRange: null, requiresPhotoEvidence: false },
];

/** Reward presets — the "what will they work for?" answer at setup. Copied into a family Reward. */
export interface RewardPreset {
  name: string;
  description: string;
  pointsCost: number;
  tier: 'small' | 'medium' | 'large';
}

export const REWARD_PRESETS: RewardPreset[] = [
  { name: 'Extra 30 minutes screen time', description: 'Half an hour more on a device, once.', pointsCost: 50, tier: 'small' },
  { name: 'Choose tonight’s dinner', description: 'You pick what the family eats.', pointsCost: 75, tier: 'small' },
  { name: 'Pick the family film', description: 'Your choice for film night.', pointsCost: 75, tier: 'small' },
  { name: 'Stay up 30 minutes later', description: 'A later bedtime, one night.', pointsCost: 100, tier: 'small' },
  { name: 'A trip to the park or playground', description: 'An afternoon out, your choice of place.', pointsCost: 150, tier: 'medium' },
  { name: 'Friend over for the afternoon', description: 'Invite a friend round.', pointsCost: 200, tier: 'medium' },
  { name: 'Baking session with a grown-up', description: 'Pick a recipe and make it together.', pointsCost: 200, tier: 'medium' },
  { name: 'A new book of your choice', description: 'Any book, within reason.', pointsCost: 250, tier: 'medium' },
  { name: 'Day out of your choosing', description: 'Cinema, swimming, bowling — you decide.', pointsCost: 500, tier: 'large' },
  { name: 'Skip one chore, guilt-free', description: 'One task of your choice, cancelled.', pointsCost: 300, tier: 'large' },
];

/** Distinct pack names, in offer order. */
export function packNames(): string[] {
  return [...new Set(SYSTEM_TEMPLATES.map((t) => t.category))];
}

/**
 * Seed the system templates. Idempotent by (category, name) so a redeploy never duplicates and never
 * overwrites an edit — the same contract as seedGames.
 */
export async function seedSystemTemplates(): Promise<void> {
  for (const t of SYSTEM_TEMPLATES) {
    const existing = await prisma.taskTemplate.findFirst({
      where: { isSystemTemplate: true, category: t.category, name: t.name },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.taskTemplate.create({
      data: {
        familyId: null, // system templates belong to no family
        isSystemTemplate: true,
        name: t.name,
        description: t.description,
        category: t.category,
        difficulty: t.difficulty,
        suggestedPoints: t.suggestedPoints,
        estimatedMinutes: t.estimatedMinutes,
        ageRange: t.ageRange,
        requiresPhotoEvidence: t.requiresPhotoEvidence,
      },
    });
  }
  console.log(`[Templates] Seeded system templates (${SYSTEM_TEMPLATES.length} across ${packNames().length} packs).`);
}

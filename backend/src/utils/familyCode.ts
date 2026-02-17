/**
 * familyCode.ts
 * Generates memorable family codes in ADJECTIVE-ANIMAL-NNNN format
 * e.g. HAPPY-LION-4821, SUNNY-WOLF-3047
 *
 * ~200M unique combinations (50 adjectives × 40 animals × 10000 numbers)
 */

import { prisma } from '../services/database';

const ADJECTIVES = [
  'BRAVE', 'BRIGHT', 'CALM', 'CLEVER', 'COOL',
  'EPIC', 'FAST', 'FIERCE', 'FUNNY', 'GENTLE',
  'GLAD', 'GOLDEN', 'GRAND', 'GREAT', 'HAPPY',
  'JOLLY', 'KIND', 'LIVELY', 'LOUD', 'LUCKY',
  'MAGIC', 'MEGA', 'MIGHTY', 'NOBLE', 'PEPPY',
  'PLAYFUL', 'PROUD', 'QUICK', 'QUIET', 'RADIANT',
  'RAPID', 'ROYAL', 'SHARP', 'SHINY', 'SILLY',
  'SMART', 'SNAPPY', 'SOLAR', 'SPEEDY', 'STELLAR',
  'STRONG', 'SUNNY', 'SUPER', 'SWIFT', 'TURBO',
  'ULTRA', 'VIVID', 'WILD', 'WISE', 'ZAPPY',
];

const ANIMALS = [
  'BEAR', 'BIRD', 'BISON', 'BUCK', 'BULL',
  'CAT', 'COBRA', 'CRANE', 'DEER', 'DOVE',
  'EAGLE', 'ELK', 'FALCON', 'FOX', 'FROG',
  'HAWK', 'HORSE', 'HOUND', 'JAGUAR', 'KITE',
  'KOALA', 'LEMUR', 'LION', 'LYNX', 'MOOSE',
  'OWL', 'PANDA', 'PANTHER', 'PARROT', 'PHOENIX',
  'PUMA', 'RAVEN', 'SHARK', 'SLOTH', 'SNAKE',
  'TIGER', 'TURTLE', 'VIPER', 'WOLF', 'ZEBRA',
];

const MAX_RETRIES = 10;

/**
 * Generates a random number between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a single family code string without DB check
 */
function buildCode(): string {
  const adjective = ADJECTIVES[randomInt(0, ADJECTIVES.length - 1)];
  const animal = ANIMALS[randomInt(0, ANIMALS.length - 1)];
  const number = randomInt(0, 9999).toString().padStart(4, '0');
  return `${adjective}-${animal}-${number}`;
}

/**
 * Generates a unique family code, retrying if the code already exists in the DB.
 * Throws if it cannot find a unique code after MAX_RETRIES attempts.
 */
export async function generateFamilyCode(): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const code = buildCode();

    const existing = await prisma.family.findUnique({
      where: { familyCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error(
    `Failed to generate a unique family code after ${MAX_RETRIES} attempts. This should be extremely rare.`
  );
}

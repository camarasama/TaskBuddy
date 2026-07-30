/**
 * gamesSeed.ts - Seed the initial quiz game definitions and their question BANKS.
 * Called once from the games router on first run OR via prisma/seed.ts.
 *
 * Each game holds a bank far larger than one play. A session draws `questionsPerSession` from it,
 * seeded by game + UTC date, so the quiz rotates daily instead of serving the same five questions
 * forever. Banks are sized so a child does not see a repeat for weeks.
 *
 * Safe to call repeatedly: existing definitions are left alone (see seedGames), so an admin's edits
 * via /admin/games are never overwritten by a redeploy.
 */
import { prisma } from '../services/database';
import { MATHS_BEGINNER, MATHS_HARD, MATHS_INTERMEDIATE } from '../content/games/maths';

const QUIZ_GAMES = [
  {
    type: 'quiz',
    title: 'Math Challenge',
    description: 'Test your arithmetic skills!',
    category: 'maths' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    // Display-only; the award path reads GAME_REWARDS[level]. Kept in step with it deliberately.
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 8,
    // Null from here on: the redesign lets a child pick any level at any age.
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'Science Quiz',
    description: 'How well do you know the natural world?',
    category: 'science' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: [
      { id: 's01', text: 'What gas do plants absorb during photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], correctIndex: 2 },
      { id: 's02', text: 'How many bones are in the adult human body?', options: ['196', '206', '216', '226'], correctIndex: 1 },
      { id: 's03', text: 'What is the closest planet to the Sun?', options: ['Venus', 'Mars', 'Mercury', 'Earth'], correctIndex: 2 },
      { id: 's04', text: 'What is the speed of light (approx)?', options: ['300,000 km/s', '150,000 km/s', '450,000 km/s', '100,000 km/s'], correctIndex: 0 },
      { id: 's05', text: 'Which organ pumps blood around the body?', options: ['Lungs', 'Brain', 'Liver', 'Heart'], correctIndex: 3 },
      { id: 's06', text: 'What is the chemical symbol for water?', options: ['H2O', 'CO2', 'O2', 'NaCl'], correctIndex: 0 },
      { id: 's07', text: 'How many planets are in our solar system?', options: ['7', '8', '9', '10'], correctIndex: 1 },
      { id: 's08', text: 'What force pulls objects towards the Earth?', options: ['Magnetism', 'Friction', 'Gravity', 'Pressure'], correctIndex: 2 },
      { id: 's09', text: 'Which part of the plant makes food?', options: ['Root', 'Stem', 'Leaf', 'Flower'], correctIndex: 2 },
      { id: 's10', text: 'What do we call animals that eat only plants?', options: ['Carnivores', 'Herbivores', 'Omnivores', 'Insectivores'], correctIndex: 1 },
      { id: 's11', text: 'At what temperature does water freeze (Celsius)?', options: ['0°C', '10°C', '32°C', '100°C'], correctIndex: 0 },
      { id: 's12', text: 'What is the largest planet in our solar system?', options: ['Saturn', 'Neptune', 'Jupiter', 'Earth'], correctIndex: 2 },
      { id: 's13', text: 'Which gas do humans need to breathe?', options: ['Nitrogen', 'Oxygen', 'Helium', 'Carbon Dioxide'], correctIndex: 1 },
      { id: 's14', text: 'What is the hardest natural substance?', options: ['Iron', 'Gold', 'Diamond', 'Quartz'], correctIndex: 2 },
      { id: 's15', text: 'How many legs does an insect have?', options: ['4', '6', '8', '10'], correctIndex: 1 },
      { id: 's16', text: 'What do bees collect from flowers?', options: ['Sap', 'Nectar', 'Pollen only', 'Water'], correctIndex: 1 },
      { id: 's17', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Mercury', 'Jupiter'], correctIndex: 1 },
      { id: 's18', text: 'What is the centre of an atom called?', options: ['Electron', 'Nucleus', 'Proton', 'Shell'], correctIndex: 1 },
      { id: 's19', text: 'What kind of animal is a frog?', options: ['Reptile', 'Amphibian', 'Mammal', 'Fish'], correctIndex: 1 },
      { id: 's20', text: 'What does a caterpillar turn into?', options: ['Beetle', 'Butterfly', 'Bee', 'Dragonfly'], correctIndex: 1 },
      { id: 's21', text: 'Which body part controls your movements?', options: ['Heart', 'Brain', 'Stomach', 'Lungs'], correctIndex: 1 },
      { id: 's22', text: 'What is the boiling point of water (Celsius)?', options: ['50°C', '90°C', '100°C', '150°C'], correctIndex: 2 },
      { id: 's23', text: 'What are clouds mostly made of?', options: ['Smoke', 'Water droplets', 'Dust', 'Air'], correctIndex: 1 },
      { id: 's24', text: 'Which animal is the largest on Earth?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Great white shark'], correctIndex: 1 },
      { id: 's25', text: 'What do we call the path a planet takes around the Sun?', options: ['Rotation', 'Orbit', 'Axis', 'Spin'], correctIndex: 1 },
    ],
  },
  {
    type: 'quiz',
    title: 'World Geography',
    description: 'Test your knowledge of world capitals and countries!',
    category: 'geography' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 12,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: [
      { id: 'g01', text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], correctIndex: 2 },
      { id: 'g02', text: 'Which is the largest country by land area?', options: ['China', 'Canada', 'USA', 'Russia'], correctIndex: 3 },
      { id: 'g03', text: 'What is the capital of Brazil?', options: ['Rio de Janeiro', 'São Paulo', 'Brasília', 'Salvador'], correctIndex: 2 },
      { id: 'g04', text: 'On which continent is Ghana located?', options: ['Asia', 'South America', 'Africa', 'Europe'], correctIndex: 2 },
      { id: 'g05', text: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correctIndex: 1 },
      { id: 'g06', text: 'What is the capital of Japan?', options: ['Osaka', 'Kyoto', 'Tokyo', 'Nagoya'], correctIndex: 2 },
      { id: 'g07', text: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
      { id: 'g08', text: 'What is the capital of Canada?', options: ['Toronto', 'Ottawa', 'Vancouver', 'Montreal'], correctIndex: 1 },
      { id: 'g09', text: 'Which country has the most people?', options: ['China', 'India', 'USA', 'Indonesia'], correctIndex: 1 },
      { id: 'g10', text: 'What is the tallest mountain in the world?', options: ['K2', 'Everest', 'Kilimanjaro', 'Denali'], correctIndex: 1 },
      { id: 'g11', text: 'What is the capital of France?', options: ['Lyon', 'Marseille', 'Paris', 'Nice'], correctIndex: 2 },
      { id: 'g12', text: 'Which desert is the largest hot desert?', options: ['Gobi', 'Kalahari', 'Sahara', 'Arabian'], correctIndex: 2 },
      { id: 'g13', text: 'How many continents are there?', options: ['5', '6', '7', '8'], correctIndex: 2 },
      { id: 'g14', text: 'What is the capital of Egypt?', options: ['Alexandria', 'Cairo', 'Giza', 'Luxor'], correctIndex: 1 },
      { id: 'g15', text: 'Which country is shaped like a boot?', options: ['Spain', 'Greece', 'Italy', 'Portugal'], correctIndex: 2 },
      { id: 'g16', text: 'What is the smallest country in the world?', options: ['Monaco', 'Vatican City', 'San Marino', 'Malta'], correctIndex: 1 },
      { id: 'g17', text: 'On which continent is the Amazon rainforest?', options: ['Africa', 'Asia', 'South America', 'Australia'], correctIndex: 2 },
      { id: 'g18', text: 'What is the capital of Kenya?', options: ['Mombasa', 'Nairobi', 'Kisumu', 'Nakuru'], correctIndex: 1 },
      { id: 'g19', text: 'Which sea is the saltiest?', options: ['Red Sea', 'Dead Sea', 'Black Sea', 'Caspian Sea'], correctIndex: 1 },
      { id: 'g20', text: 'What is the capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Ibadan'], correctIndex: 1 },
      { id: 'g21', text: 'Which country is both in Europe and Asia?', options: ['Greece', 'Turkey', 'Poland', 'Norway'], correctIndex: 1 },
      { id: 'g22', text: 'What is the capital of India?', options: ['Mumbai', 'Kolkata', 'New Delhi', 'Chennai'], correctIndex: 2 },
      { id: 'g23', text: 'Which river runs through London?', options: ['Severn', 'Thames', 'Mersey', 'Tyne'], correctIndex: 1 },
      { id: 'g24', text: 'What is the largest island in the world?', options: ['Borneo', 'Madagascar', 'Greenland', 'New Guinea'], correctIndex: 2 },
      { id: 'g25', text: 'Which continent is the coldest?', options: ['Europe', 'Asia', 'Antarctica', 'North America'], correctIndex: 2 },
    ],
  },
  // ── Phase D content ─────────────────────────────────────────────────────────
  //
  // Banks live in src/content/games/ — eighteen of them inline here would be unreadable. `maths /
  // beginner` is deliberately absent: it already exists above as "Math Challenge", and seedGames matches
  // on title, so re-declaring it would be a no-op at best and a duplicate row at worst.
  {
    type: 'quiz',
    title: 'Maths Workout',
    description: 'Percentages, ratios, shapes and a bit of algebra.',
    category: 'maths' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    // Display-only; the award path reads GAME_REWARDS[level].
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Maths Master',
    description: 'Algebra, powers, probability and compound percentages.',
    category: 'maths' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_HARD,
  },
];

export async function seedGames(): Promise<void> {
  for (const game of QUIZ_GAMES) {
    const existing = await prisma.gameDefinition.findFirst({ where: { title: game.title } });
    if (!existing) {
      // Cast only here: the arrays stay strongly typed above so backfillGameBanks can read id/text.
      await prisma.gameDefinition.create({ data: game as unknown as Parameters<typeof prisma.gameDefinition.create>[0]['data'] });
      console.log(`[Games] Seeded: ${game.title} (${game.questionsJson.length} questions)`);
    }
  }
}

/**
 * Top up the SEEDED games to their full banks without touching anything else.
 *
 * The original seed shipped 5 questions per game and `seedGames` skips definitions that already
 * exist, so an existing deployment would keep serving the same five questions forever and the daily
 * rotation would have nothing to rotate. This backfills only questions whose id is missing, so
 * admin-authored questions and edited metadata are preserved.
 *
 * Run once after deploying rotation:
 *   node backend/dist/scripts/backfill-game-banks.js
 */
/** Normalise question text for duplicate detection: case, surrounding and repeated whitespace. */
function normaliseText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function backfillGameBanks(): Promise<void> {
  for (const game of QUIZ_GAMES) {
    const existing = await prisma.gameDefinition.findFirst({ where: { title: game.title } });
    if (!existing) continue;

    const current =
      (existing.questionsJson as unknown as Array<{ id: string; text: string }>) ?? [];
    const currentIds = new Set(current.map((q) => q.id));
    // Match on TEXT as well as id. The original seed used ids q1-q5 for every game while the banks
    // here use per-topic ids (m01, s01, g01...), so an id-only check finds no overlap and appends
    // all 25 - leaving the first five duplicated under two ids. A daily draw treats those as
    // distinct entries and could serve the same question twice in one quiz.
    const currentTexts = new Set(current.map((q) => normaliseText(q.text ?? '')));

    const missing = game.questionsJson.filter(
      (q) => !currentIds.has(q.id) && !currentTexts.has(normaliseText(q.text)),
    );

    if (missing.length === 0) {
      console.log(`[Games] ${game.title}: bank already complete (${current.length} questions)`);
      continue;
    }

    await prisma.gameDefinition.update({
      where: { id: existing.id },
      data: { questionsJson: [...current, ...missing] },
    });
    console.log(
      `[Games] ${game.title}: added ${missing.length} questions (${current.length} → ${current.length + missing.length})`,
    );
  }
}

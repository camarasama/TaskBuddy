/**
 * gamesSeed.ts — Seed initial quiz game definitions.
 * Called once from the games router on first run OR via prisma/seed.ts.
 * Safe to call multiple times (upserts by title).
 */
import { prisma } from '../services/database';

const QUIZ_GAMES = [
  {
    type: 'quiz',
    title: 'Math Challenge',
    description: 'Test your arithmetic skills!',
    difficulty: 'easy' as const,
    pointsReward: 15,
    xpReward: 8,
    cooldownHours: 12,
    ageGroup: '10-12',
    questionsJson: [
      { id: 'q1', text: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
      { id: 'q2', text: 'What is 144 ÷ 12?', options: ['10', '11', '12', '13'], correctIndex: 2 },
      { id: 'q3', text: 'What is 15% of 200?', options: ['25', '30', '35', '40'], correctIndex: 1 },
      { id: 'q4', text: 'What is 2³?', options: ['6', '8', '9', '16'], correctIndex: 1 },
      { id: 'q5', text: 'What is the square root of 81?', options: ['7', '8', '9', '10'], correctIndex: 2 },
    ],
  },
  {
    type: 'quiz',
    title: 'Science Quiz',
    description: 'How well do you know the natural world?',
    difficulty: 'medium' as const,
    pointsReward: 25,
    xpReward: 15,
    cooldownHours: 24,
    ageGroup: null,
    questionsJson: [
      { id: 'q1', text: 'What gas do plants absorb during photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], correctIndex: 2 },
      { id: 'q2', text: 'How many bones are in the adult human body?', options: ['196', '206', '216', '226'], correctIndex: 1 },
      { id: 'q3', text: 'What is the closest planet to the Sun?', options: ['Venus', 'Mars', 'Mercury', 'Earth'], correctIndex: 2 },
      { id: 'q4', text: 'What is the speed of light (approx)?', options: ['300,000 km/s', '150,000 km/s', '450,000 km/s', '100,000 km/s'], correctIndex: 0 },
      { id: 'q5', text: 'Which organ pumps blood around the body?', options: ['Lungs', 'Brain', 'Liver', 'Heart'], correctIndex: 3 },
    ],
  },
  {
    type: 'quiz',
    title: 'World Geography',
    description: 'Test your knowledge of world capitals and countries!',
    difficulty: 'hard' as const,
    pointsReward: 35,
    xpReward: 20,
    cooldownHours: 24,
    ageGroup: '13-16',
    questionsJson: [
      { id: 'q1', text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], correctIndex: 2 },
      { id: 'q2', text: 'Which is the largest country by land area?', options: ['China', 'Canada', 'USA', 'Russia'], correctIndex: 3 },
      { id: 'q3', text: 'What is the capital of Brazil?', options: ['Rio de Janeiro', 'São Paulo', 'Brasília', 'Salvador'], correctIndex: 2 },
      { id: 'q4', text: 'On which continent is Ghana located?', options: ['Asia', 'South America', 'Africa', 'Europe'], correctIndex: 2 },
      { id: 'q5', text: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correctIndex: 1 },
    ],
  },
];

export async function seedGames(): Promise<void> {
  for (const game of QUIZ_GAMES) {
    const existing = await prisma.gameDefinition.findFirst({ where: { title: game.title } });
    if (!existing) {
      await prisma.gameDefinition.create({ data: game });
      console.log(`[Games] Seeded: ${game.title}`);
    }
  }
}

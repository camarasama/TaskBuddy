/**
 * Create the public demo family: 1 parent, 2 children, task history, achievements and rewards.
 *
 * Its logins are meant to be posted publicly (launch sites, Reddit), so the family is flagged
 * is_demo_account, which turns off account changes, email and uploads for it (services/
 * demoAccount.ts), and is_test_account, so admin KPIs and re-engagement email skip it.
 *
 *   node backend/dist/scripts/create-demo-family.js
 *   node backend/dist/scripts/create-demo-family.js --email demo@gettaskbuddy.com
 *
 * Refuses to run if a demo family already exists. Prints the logins once at the end; the passwords
 * are generated here and stored only as hashes.
 *
 * Everything after the account itself goes through the real services (TaskService, RewardService),
 * so points, XP, levels, streaks and achievements are what the app itself would have computed.
 */
// MUST come first: it loads .env, which services/database needs (see backfill-level-fields.ts).
import '../config';
import crypto from 'crypto';
import { prisma } from '../services/database';
import { authService } from '../services/auth';
import { TaskService } from '../services/TaskService';
import { RewardService } from '../services/RewardService';
import { CONSENT_VERSIONS, difficultyFromPoints } from '@taskbuddy/shared';

const FAMILY_NAME = 'TaskBuddy Demo Family';

interface DemoTask {
  title: string;
  description: string;
  points: number;
  tag: 'primary' | 'secondary';
}

const HISTORY: Record<'maya' | 'leo', DemoTask[]> = {
  maya: [
    { title: 'Make your bed', description: 'Sheets straight, pillows on.', points: 10, tag: 'primary' },
    { title: 'Unload the dishwasher', description: 'Put everything back where it lives.', points: 15, tag: 'secondary' },
    { title: 'Homework before screens', description: 'All of tonight\'s homework done first.', points: 20, tag: 'primary' },
    { title: 'Tidy your room', description: 'Floor clear, clothes in the basket.', points: 25, tag: 'primary' },
    { title: 'Read for 20 minutes', description: 'Any book you like.', points: 15, tag: 'secondary' },
  ],
  leo: [
    { title: 'Feed the cat', description: 'Morning and evening.', points: 10, tag: 'primary' },
    { title: 'Take out the recycling', description: 'Bins out by 8pm.', points: 10, tag: 'secondary' },
    { title: 'Water the plants', description: 'Kitchen and living room.', points: 10, tag: 'primary' },
  ],
};

/** Done by the child and waiting for the parent, so visitors can try approving. */
const AWAITING: Record<'maya' | 'leo', DemoTask> = {
  maya: { title: 'Fold the laundry', description: 'Your own clothes, folded and put away.', points: 20, tag: 'secondary' },
  leo: { title: 'Set the table', description: 'Plates, cutlery and glasses for everyone.', points: 10, tag: 'secondary' },
};

/** Still to do, so visitors signed in as a child have something to complete. */
const OPEN: Record<'maya' | 'leo', DemoTask[]> = {
  maya: [{ title: 'Clean the bathroom sink', description: 'Sink and mirror sparkling.', points: 25, tag: 'primary' }],
  leo: [{ title: 'Pack your school bag', description: 'Books, PE kit and lunch box.', points: 10, tag: 'primary' }],
};

const REWARDS = [
  { name: '30 minutes extra screen time', description: 'Use it any evening this week.', pointsCost: 50, tier: 'small' },
  { name: 'Pick the family movie', description: 'You choose what we watch on Friday.', pointsCost: 40, tier: 'small' },
  { name: 'Choose Saturday\'s dinner', description: 'Pizza, tacos, you name it.', pointsCost: 120, tier: 'medium' },
  { name: 'A day out of your choice', description: 'Cinema, bowling, theme park...', pointsCost: 500, tier: 'large' },
] as const;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function randomPin(): string {
  return String(crypto.randomInt(1000, 10000));
}

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return d;
}

function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60_000).toISOString();
}

async function createTask(familyId: string, parentId: string, childId: string, t: DemoTask) {
  const { assignments } = await TaskService.createTask({
    familyId,
    createdBy: parentId,
    taskTag: t.tag,
    assignedTo: [childId],
    dueDate: tomorrow(),
    taskData: {
      title: t.title,
      description: t.description,
      pointsValue: t.points,
      difficulty: difficultyFromPoints(t.points),
    },
  });
  return assignments[0].id;
}

async function complete(familyId: string, childId: string, assignmentId: string) {
  await TaskService.submitCompletion({ assignmentId, familyId, userId: childId, userRole: 'child' });
}

async function main() {
  const email = (argValue('--email') ?? 'demo@gettaskbuddy.com').toLowerCase();

  const existing = await prisma.family.findFirst({ where: { isDemoAccount: true }, select: { id: true } });
  if (existing) {
    throw new Error(`A demo family already exists (${existing.id}). Not creating a second one.`);
  }

  // Public anyway, but long enough that nobody guesses it before the post goes up.
  const password = `TryTaskBuddy-${crypto.randomInt(1000, 10000)}`;
  const pins = { maya: randomPin(), leo: randomPin() };

  const { family, user: parent } = await authService.register({
    familyName: FAMILY_NAME,
    parent: { firstName: 'Alex', lastName: 'Demo', email, password },
  });

  // Flag FIRST: every service call below would otherwise send real email for this family.
  await prisma.family.update({
    where: { id: family.id },
    data: { isDemoAccount: true, isTestAccount: true },
  });
  await prisma.user.update({ where: { id: parent.id }, data: { emailVerifiedAt: new Date() } });
  // The demo children are fictional. Recorded as verified so the app treats the family like any
  // other; the method name says why there was no email round-trip.
  await prisma.parentalConsent.create({
    data: {
      familyId: family.id,
      parentId: parent.id,
      method: 'demo_fictional_children',
      status: 'verified',
      verifiedAt: new Date(),
      tosVersion: CONSENT_VERSIONS.tos,
      privacyVersion: CONSENT_VERSIONS.privacy,
    },
  });

  const maya = await authService.addChild({
    familyId: family.id, firstName: 'Maya', lastName: 'Demo', dateOfBirth: yearsAgo(13),
    username: 'maya', pin: pins.maya, createdBy: parent.id,
  });
  const leo = await authService.addChild({
    familyId: family.id, firstName: 'Leo', lastName: 'Demo', dateOfBirth: yearsAgo(11),
    username: 'leo', pin: pins.leo, createdBy: parent.id,
  });
  const children = { maya: maya.user.id, leo: leo.user.id };

  for (const key of ['maya', 'leo'] as const) {
    const childId = children[key];
    // One at a time: a child may hold at most 3 open tasks, and only 1 must-do.
    for (const t of HISTORY[key]) {
      const assignmentId = await createTask(family.id, parent.id, childId, t);
      await complete(family.id, childId, assignmentId);
      await TaskService.approveAssignment({ assignmentId, familyId: family.id, parentId: parent.id, approved: true });
    }
    await complete(family.id, childId, await createTask(family.id, parent.id, childId, AWAITING[key]));
    for (const t of OPEN[key]) await createTask(family.id, parent.id, childId, t);
  }

  const rewards = [];
  for (const r of REWARDS) {
    rewards.push(await prisma.reward.create({ data: { ...r, familyId: family.id, createdBy: parent.id } }));
  }
  // Maya spends some points, so the parent has a redemption to hand over.
  await RewardService.redeem({ rewardId: rewards[1].id, familyId: family.id, childId: children.maya });

  const profiles = await prisma.childProfile.findMany({
    where: { userId: { in: Object.values(children) } },
    select: { userId: true, pointsBalance: true, level: true },
  });
  const unlocked = await prisma.childAchievement.count({ where: { childId: { in: Object.values(children) } } });
  const familyCode = (await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).familyCode;

  console.log(`
Demo family created: ${FAMILY_NAME} (${family.id})
Flags: is_demo_account = true, is_test_account = true

Parent login (https://app.gettaskbuddy.com/login)
  email:    ${email}
  password: ${password}

Child logins (family code ${familyCode})
  maya  PIN ${pins.maya}
  leo   PIN ${pins.leo}

Children: ${profiles.map((p) => `${p.userId === children.maya ? 'Maya' : 'Leo'} ${p.pointsBalance} pts, level ${p.level}`).join('; ')}
Achievements unlocked: ${unlocked}
`);
}

main()
  .catch((err) => {
    console.error('[create-demo-family] failed:', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

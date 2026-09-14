/**
 * The child app's shared visual system: its colours stay readable, and its screens keep using it.
 *
 * Two halves.
 *
 * 1. **Contrast, measured.** Every gradient header carries text at every point along it, so its ink is
 *    checked against every stop, not just the first. Every tint's `textInk` must clear AA on its fill.
 *    The old home hero failed exactly this (white on xp 500 is 3.96:1) and nobody noticed because a
 *    gradient is hard to eyeball.
 * 2. **The screens use it.** The pass exists because Tasks, Rewards and the Me screens had drifted into a
 *    plain style of their own while Home and Games were colourful. A source read, per the reasoning in
 *    `templates-wiring.test.ts`, keeps a future screen from quietly drifting back.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { GRADIENT, TINT } from '@/theme/accents';

/** WCAG 2.1 relative luminance. Same formula as `design-tokens.test.ts`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe('gradient headers keep their text readable', () => {
  it.each(Object.entries(GRADIENT))('%s: ink clears AA against every stop', (_tone, spec) => {
    for (const stop of spec.colors) {
      expect(contrast(spec.ink, stop)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('tints keep their text readable', () => {
  it.each(Object.entries(TINT))('%s: textInk clears AA on its fill', (_tone, tint) => {
    expect(contrast(tint.textInk, tint.fill)).toBeGreaterThanOrEqual(AA);
  });
});

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

/** Child screens that open on the shared masthead. Home and Games have their own hero cards. */
const HEADED_SCREENS = [
  ['(child)', 'tasks.tsx'],
  ['(child)', 'rewards.tsx'],
  ['(child)', 'task-detail.tsx'],
  ['(child)', 'me', 'index.tsx'],
  ['(child)', 'me', 'achievements.tsx'],
  ['(child)', 'me', 'leaderboard.tsx'],
  ['(child)', 'me', 'recap.tsx'],
  ['(child)', 'me', 'cosmetics.tsx'],
  ['(child)', 'games', 'history.tsx'],
];

describe.each(HEADED_SCREENS)('%s/%s', (...parts) => {
  const source = read(...parts);

  it('opens on the shared GradientHeader', () => {
    expect(source).toMatch(/from '@\/components\/GradientHeader'/);
    expect(source).toMatch(/<GradientHeader\b/);
  });
});

describe('gradients come from the shared table, never a local list of stops', () => {
  const GRADIENT_USERS = [
    ['(child)', 'dashboard.tsx'],
    ['(child)', 'games', 'index.tsx'],
    ['(child)', 'games', 'review.tsx'],
  ];

  it.each(GRADIENT_USERS)('%s/%s', (...parts) => {
    const source = read(...parts);
    // The old hero's stops. White on xp 500 fails AA, which is why they were replaced.
    expect(source).not.toMatch(/palette\.xp\[500\], palette\.primary\[500\]/);
    expect(source).toMatch(/GRADIENT\.\w+\.colors/);
  });
});

describe('the small bugs found alongside the pass stay fixed', () => {
  it('Home and Tasks label a task with the same date rule', () => {
    expect(read('(child)', 'dashboard.tsx')).toMatch(/assignmentDate\(assignment\.instanceDate, task\.dueDate\)/);
    expect(read('(child)', 'tasks.tsx')).toMatch(/assignmentDate\(item\.instanceDate, task\.dueDate\)/);
  });

  it('"Finish your current task first." appears once on the Tasks screen, not once per card', () => {
    const matches = read('(child)', 'tasks.tsx').match(/'Finish your current task first\.'/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

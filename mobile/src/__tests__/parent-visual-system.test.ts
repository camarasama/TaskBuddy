/**
 * The parent app's half of the shared visual system, and the four additions the owner approved with it.
 *
 * A source read rather than a render, for the reason in `templates-wiring.test.ts`: the screens pull in
 * the router, queries and native modules, and what these guards care about is visible in the source.
 *
 * Contrast for the parent-only tones (`amber`, `danger`) is already enforced by
 * `child-visual-system.test.ts`, which checks every entry in the shared gradient table.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

/** Every screen in the parent group except the two that do not draw a page of their own. */
const PARENT_SCREENS = readdirSync(join(APP, '(parent)'))
  .filter((file) => file.endsWith('.tsx'))
  .filter((file) => file !== '_layout.tsx' && file !== 'notifications.tsx');

describe.each(PARENT_SCREENS)('(parent)/%s', (file) => {
  const source = read('(parent)', file);

  it('opens on the shared GradientHeader', () => {
    expect(source).toMatch(/<GradientHeader\b/);
  });

  it('draws no checkbox out of text characters', () => {
    // "☐" and "☑" render at a different size on every Android font and read as a typo. ToggleRow and
    // a drawn checkbox replaced them.
    expect(source).not.toMatch(/[☐☑]/);
  });
});

describe('the consent email landing page and the shared notifications list use it too', () => {
  it('parent/consent/confirm', () => {
    expect(read('parent', 'consent', 'confirm.tsx')).toMatch(/<GradientHeader\b/);
  });

  it('NotificationList (parent and child)', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'NotificationList.tsx'), 'utf8');
    expect(source).toMatch(/<GradientHeader\b/);
  });
});

describe('red is reserved for deleting the account', () => {
  it.each(PARENT_SCREENS)('%s', (file) => {
    const source = read('(parent)', file);
    if (file === 'delete-account.tsx') {
      expect(source).toMatch(/tone="danger"/);
    } else {
      expect(source).not.toMatch(/tone="danger"/);
    }
  });
});

describe('the four additions approved with the redesign', () => {
  it('1. Reports is reachable: Home links to it', () => {
    // Before the pass, `(parent)/reports` existed and nothing in the app pushed it.
    expect(read('(parent)', 'dashboard.tsx')).toContain("router.push('/(parent)/reports')");
  });

  it('2. Reports picks dates instead of asking for YYYY-MM-DD', () => {
    const source = read('(parent)', 'reports.tsx');
    expect(source).toMatch(/<DateField\b/);
    expect(source).not.toMatch(/YYYY-MM-DD"/);
  });

  it('3. the task form shows the difficulty its points will get, from the shared rule', () => {
    const source = read('(parent)', 'task-form.tsx');
    expect(source).toMatch(/import \{ difficultyFromPoints \} from '@taskbuddy\/shared'/);
    expect(source).toMatch(/difficultyFromPoints\(pointsValue\)/);
    // Shown, never chosen: a picker would be silently overruled by the server.
    expect(source).not.toMatch(/setDifficulty/);
  });

  it('4. the shared notifications list gives each kind its own tile', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'NotificationList.tsx'), 'utf8');
    expect(source).toMatch(/KIND\[item\.notificationType\]/);
  });
});

describe('header shortcuts open the sheet they promise', () => {
  it('"From a template" opens the task form with the picker up', () => {
    expect(read('(parent)', 'tasks.tsx')).toMatch(/params: \{ template: '1' \}/);
    expect(read('(parent)', 'task-form.tsx')).toMatch(/useState\(openTemplatesFirst\)/);
  });

  it('"Need ideas?" opens the reward form with the ideas up', () => {
    expect(read('(parent)', 'rewards.tsx')).toMatch(/params: \{ ideas: '1' \}/);
    expect(read('(parent)', 'reward-form.tsx')).toMatch(/useState\(openIdeasFirst\)/);
  });
});

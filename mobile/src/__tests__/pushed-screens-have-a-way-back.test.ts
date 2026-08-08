/**
 * Every screen a child can be pushed into offers a way back out.
 *
 * Reported symptom: "the Me page opens notifications". Not a routing misconfiguration: the Me stack
 * resolves `index` first, as it should. Two things combined:
 *
 *  1. `(child)/me/_layout.tsx` and `(child)/games/_layout.tsx` both run `headerShown: false`, so a
 *     pushed screen gets no native header and therefore no back button. Five of the six screens
 *     behind those tabs rendered none of their own, so once a child tapped "See all" on the Me hub
 *     the only exit was Android's system back gesture.
 *  2. React Navigation preserves each tab's stack. A child who left the app sitting on Notifications
 *     found the Me tab opening there every time afterwards.
 *
 * Guarded as a source read rather than a render, for the reason spelled out in `templates-wiring.
 * test.ts`: this project has no `@testing-library/react-native`, so screen source is what a test can
 * actually see. The rule is per-return-branch on purpose, because a back control present only on the success
 * branch strands a child on exactly the screens where they most need out, the loading and error ones.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..', 'app');

/** Screens reachable only by a push, and the hub each one has to lead back to. */
const PUSHED_SCREENS: [string, string, string][] = [
  ['(child)/me/achievements.tsx', 'Back to Me', '/(child)/me'],
  ['(child)/me/cosmetics.tsx', 'Back to Me', '/(child)/me'],
  ['(child)/me/leaderboard.tsx', 'Back to Me', '/(child)/me'],
  ['(child)/me/recap.tsx', 'Back to Me', '/(child)/me'],
  ['(child)/games/history.tsx', 'Back to Games', '/(child)/games'],
];

describe.each(PUSHED_SCREENS)('%s', (file, label, href) => {
  const source = readFileSync(join(APP_ROOT, ...file.split('/')), 'utf8');

  it('renders a BackLink pointing at its hub', () => {
    expect(source).toContain(`<BackLink label="${label}" href="${href}" />`);
  });

  it('renders one on every branch that returns a Screen, loading and error included', () => {
    const screenOpenings = source.match(/<Screen(\s[^>]*)?>/g) ?? [];
    const backLinks = source.match(/<BackLink\b/g) ?? [];

    expect(screenOpenings.length).toBeGreaterThan(0);
    expect(backLinks.length).toBe(screenOpenings.length);
  });
});

/**
 * The notifications centre is shared by both shells, so its back target is a required prop rather
 * than something the component picks. Both callers must supply one.
 */
describe('the notifications centre is given a way back by both of its routes', () => {
  it('child', () => {
    const source = readFileSync(join(APP_ROOT, '(child)', 'me', 'notifications.tsx'), 'utf8');
    expect(source).toMatch(/back=\{\{\s*label:\s*'Back to Me',\s*href:\s*'\/\(child\)\/me'\s*\}\}/);
  });

  it('parent', () => {
    const source = readFileSync(join(APP_ROOT, '(parent)', 'notifications.tsx'), 'utf8');
    expect(source).toMatch(/back=\{\{\s*label:\s*'Back to Dashboard'/);
  });

  it('makes `back` non-optional, so a third caller cannot omit it', () => {
    const source = readFileSync(
      join(__dirname, '..', 'components', 'NotificationList.tsx'),
      'utf8'
    );
    // `back:` not `back?:`, which is the whole point of the prop.
    expect(source).toMatch(/back:\s*\{\s*label:\s*string;\s*href:\s*string\s*\}/);
  });
});

describe('the Me tab reopens on its hub', () => {
  const source = readFileSync(join(APP_ROOT, '(child)', '_layout.tsx'), 'utf8');

  it('resets the Me stack on tab press', () => {
    expect(source).toMatch(/listeners=\{\{\s*tabPress:.*\/\(child\)\/me'\)\s*\}\}/s);
  });

  it('leaves the Games tab alone, so a quiz in progress survives a tab switch', () => {
    const gamesTab = source.slice(source.indexOf('name="games"'), source.indexOf('name="me"'));
    expect(gamesTab).not.toContain('listeners');
  });
});

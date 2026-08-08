/**
 * The setup wizard is actually reachable, actually calls the real pipeline, and is registered as a
 * non-tab — pinned as a source guard for the same reason `templates-wiring.test.ts` is: these are React
 * Native screens with no DOM to render against in a plain jest run (no `@testing-library/react-native`
 * is set up for `app/**` in this project), so the only place "does the wiring still exist" is visible
 * as text is the source file itself.
 *
 * What `onboardingApi.test.ts` cannot see is whether `welcome.tsx` still calls any of these functions —
 * a refactor could delete the import and the API test would keep passing while the wizard silently lost
 * its own engine. What no unit test can see at all is the routing wiring: which screen a newly
 * registered parent lands on, and whether the tab layout still hides `welcome` from the tab bar.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..', 'app');

const welcomeSource = readFileSync(join(APP_ROOT, '(parent)', 'welcome.tsx'), 'utf8');

/**
 * A name is "used", not just imported, when it appears again after the import statement — either as a
 * direct call (`seedFirstApproval(`) or handed to something else as a value (`mutationFn:
 * completeOnboardingStep`, which is how `welcome.tsx` wires the two mutable steps through
 * `useMutation` rather than calling them bare). An import with no second occurrence at all would mean
 * the wiring was imported and then never actually used, which is the regression this guards against —
 * broadened from `templates-wiring.test.ts`'s call-only check because a `useMutation`-wrapped function
 * is exactly as real a use as a direct call and a stricter check would false-fail on it.
 */
function occurrencesAfterImport(source: string, name: string, fromModule: string): number {
  const importLine = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${fromModule}['"]`);
  expect(source).toMatch(importLine);

  const afterImportIndex = source.search(importLine);
  const rest = source.slice(afterImportIndex + source.slice(afterImportIndex).indexOf('\n'));
  const uses = rest.match(new RegExp(`\\b${name}\\b`, 'g'));
  return uses?.length ?? 0;
}

describe('welcome.tsx wires up the onboarding API', () => {
  it('reads progress from onboardingQuery', () => {
    expect(occurrencesAfterImport(welcomeSource, 'onboardingQuery', '@/lib/onboardingApi')).toBeGreaterThan(0);
  });

  it('marks steps done through completeOnboardingStep', () => {
    expect(
      occurrencesAfterImport(welcomeSource, 'completeOnboardingStep', '@/lib/onboardingApi')
    ).toBeGreaterThan(0);
  });

  it('skips through dismissOnboarding, not by inventing its own "seen it" flag', () => {
    expect(occurrencesAfterImport(welcomeSource, 'dismissOnboarding', '@/lib/onboardingApi')).toBeGreaterThan(0);
  });

  it('seeds the engineered first task through seedFirstApproval', () => {
    expect(occurrencesAfterImport(welcomeSource, 'seedFirstApproval', '@/lib/onboardingApi')).toBeGreaterThan(0);
  });
});

describe('welcome.tsx runs the REAL approval pipeline, not a mock', () => {
  it('calls decideApproval — the same PUT /tasks/assignments/:id/approve every approval uses', () => {
    // This is the load-bearing assertion in the whole file: the brief for this unit is explicit that
    // the seeded task must be approved for real (points, XP, socket event), not faked client-side.
    expect(occurrencesAfterImport(welcomeSource, 'decideApproval', '@/lib/approvalsApi')).toBeGreaterThan(0);
  });
});

describe('(parent)/_layout.tsx registers welcome as a non-tab', () => {
  const layoutSource = readFileSync(join(APP_ROOT, '(parent)', '_layout.tsx'), 'utf8');

  it('gives welcome href: null so it does not get a default tab', () => {
    expect(layoutSource).toMatch(/<Tabs\.Screen\s+name="welcome"\s+options=\{\{\s*href:\s*null\s*\}\}\s*\/>/);
  });

  it('touches nothing else about the five real tabs', () => {
    // A guard against scope creep on a file another unit edits concurrently, not a behavioural test:
    // the five tab screens this layout has always had must still be there, unchanged in kind.
    for (const tab of ['dashboard', 'tasks', 'approvals', 'children', 'rewards']) {
      expect(layoutSource).toContain(`name="${tab}"`);
    }
  });
});

describe('register.tsx sends a newly registered parent straight into the wizard', () => {
  const registerSource = readFileSync(join(APP_ROOT, 'register.tsx'), 'utf8');

  it('replaces into /(parent)/welcome after account creation', () => {
    expect(registerSource).toMatch(/router\.replace\(\s*['"]\/\(parent\)\/welcome['"]\s*\)/);
  });

  it('does not also replace into the bare role chooser — there should be one redirect, not two', () => {
    // A stray `router.replace('/')` left behind by an incomplete edit would race the wizard redirect
    // and make the destination depend on render timing rather than being deterministic.
    expect(registerSource).not.toMatch(/router\.replace\(\s*['"]\/['"]\s*\)/);
  });
});

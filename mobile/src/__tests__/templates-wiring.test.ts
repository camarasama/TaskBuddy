/**
 * The create forms actually offer starter content — pinned as a source guard, deliberately, rather
 * than only behaviourally.
 *
 * `templatesApi.test.ts` already exercises `fillFromTaskTemplate` and `fillFromRewardPreset` as pure
 * functions: given a template row, do the right form values come out (points clamped, description
 * defaulted, difficulty never carried across). That is the higher-value test and it already exists —
 * duplicating it here would test the same code twice with no added protection.
 *
 * What that test CANNOT see is whether either screen still calls those functions at all. The regression
 * this guards against is a screen import getting deleted or dead-coded during a refactor (an unused
 * import that lint quietly removes, or a picker sheet ripped out without its wiring): `templatesApi.
 * test.ts` would keep passing — the functions still work — while a parent creating a task or reward
 * would silently lose the "pick from a template" entry point the growth roadmap's activation work
 * depends on. Only reading the screen source can catch that, since these are React Native screens with
 * no DOM to query in a plain jest run (no `@testing-library/react-native` is set up in this project —
 * see the absence of it across every other `app/**` test in this repo).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..', 'app');

/**
 * A name is "used", not just imported, when it appears again after the import statement — e.g. as a
 * call `fillFromTaskTemplate(` or spread into a hook `...taskTemplatesQuery(`. An import with no
 * second occurrence would mean the wiring was imported and then never actually invoked.
 */
function occurrencesAfterImport(source: string, name: string): number {
  const importLine = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]@/lib/templatesApi['"]`);
  expect(source).toMatch(importLine);

  const afterImportIndex = source.search(importLine);
  const rest = source.slice(afterImportIndex + source.slice(afterImportIndex).indexOf('\n'));
  const calls = rest.match(new RegExp(`${name}\\s*\\(`, 'g'));
  return calls?.length ?? 0;
}

describe('task-form.tsx wires up the task template picker', () => {
  const source = readFileSync(join(APP_ROOT, '(parent)', 'task-form.tsx'), 'utf8');

  it('imports and calls taskTemplatesQuery to fetch the list', () => {
    expect(occurrencesAfterImport(source, 'taskTemplatesQuery')).toBeGreaterThan(0);
  });

  it('imports and calls fillFromTaskTemplate to pre-fill the form from a pick', () => {
    expect(occurrencesAfterImport(source, 'fillFromTaskTemplate')).toBeGreaterThan(0);
  });
});

describe('reward-form.tsx wires up the reward preset picker', () => {
  const source = readFileSync(join(APP_ROOT, '(parent)', 'reward-form.tsx'), 'utf8');

  it('imports and calls rewardPresetsQuery to fetch the list', () => {
    expect(occurrencesAfterImport(source, 'rewardPresetsQuery')).toBeGreaterThan(0);
  });

  it('imports and calls fillFromRewardPreset to pre-fill the form from a pick', () => {
    expect(occurrencesAfterImport(source, 'fillFromRewardPreset')).toBeGreaterThan(0);
  });
});

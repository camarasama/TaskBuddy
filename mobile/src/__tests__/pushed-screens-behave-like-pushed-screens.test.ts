/**
 * Both shells are Tabs navigators, and every screen a user "opens" is a `Tabs.Screen` with
 * `href: null` rather than a stack screen. Two consequences bit at once, reported together:
 *
 *   1. "when opening an item to see the details (task or reward), when going back I am sent to home
 *      tab which should not be". expo-router turns PUSH into NAVIGATE outside a stack, and the
 *      TabRouter's default `backBehavior` is `firstRoute`, i.e. literally "go to the first tab".
 *
 *   2. "create task, saved, went back to home, came back to tasks, create new task, the previous
 *      task creation is still open and the button is greyed out with the loading animation". A tab
 *      screen mounts once and is kept forever, so the form came back holding the last visit's state.
 *      React Navigation 7 removed `unmountOnBlur`, and `freezeOnBlur` does not discard state.
 *
 * Source guards, matching the rest of this suite. Both failures are silent at build time and only
 * show up in a specific navigation sequence on a device, which is exactly what a guard is for.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', '..', 'app');
const LIB = join(__dirname, '..', 'lib');
const read = (base: string, ...p: string[]) => readFileSync(join(base, ...p), 'utf8');

const PARENT_LAYOUT = read(APP, '(parent)', '_layout.tsx');
const CHILD_LAYOUT = read(APP, '(child)', '_layout.tsx');
const HOOK = read(LIB, 'useFreshOnFocus.ts');

const FORMS = ['task-form', 'reward-form', 'child-form'] as const;

describe('going back does not jump to the first tab', () => {
  it.each([
    ['parent', PARENT_LAYOUT],
    ['child', CHILD_LAYOUT],
  ])('%s shell sets backBehavior="history"', (_name, layout) => {
    // The default is `firstRoute`. Leaving it unset is what sent every "back" to Home.
    expect(layout).toMatch(/backBehavior="history"/);
  });
});

describe('a form opened twice is a fresh form', () => {
  it.each(FORMS)('%s remounts on focus', (form) => {
    const source = read(APP, '(parent)', `${form}.tsx`);

    // A changed `key` is the only thing that reliably throws a subtree's state away here.
    expect(source).toMatch(/key=\{useFreshOnFocus\(\)\}/);
    expect(source).toMatch(/from '@\/lib\/useFreshOnFocus'/);
  });

  it.each(FORMS)('%s clears busy in a finally, not only on failure', (form) => {
    const source = read(APP, '(parent)', `${form}.tsx`);

    // Leaving `busy` true on the happy path is what greyed the button out with its spinner. The
    // remount is the primary fix; this keeps the state honest on its own.
    expect(source).toMatch(/\} finally \{[\s\S]{0,400}?setBusy\(false\);/);
    // And it must not ALSO be sitting in the catch, which would just be noise now.
    expect(source).not.toMatch(/setError\(describeError\(caught\)\);\s*setBusy\(false\);/);
  });

  it('the hook increments from a stable callback, so it cannot spin', () => {
    // `useFocusEffect` re-runs whenever its callback identity changes. An inline arrow would make
    // every increment schedule another one.
    expect(HOOK).toMatch(/useCallback\(\(\) => \{\s*setOpenedCount\(\(n\) => n \+ 1\);\s*\}, \[\]\)/);
  });
});

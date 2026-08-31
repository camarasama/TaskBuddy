/**
 * Where the rating prompt fires from, pinned as a source guard.
 *
 * `reviewPolicy.test.ts` proves the rules are right. What it cannot see is which moment the app calls
 * them at, and that is the half the ASO advice is actually about: a prompt after a good moment earns a
 * review, the same prompt after a bad one earns a one-star. There is no render test for these screens
 * (see `onboarding-wizard-wiring.test.ts`), so the source is where this is visible.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..', '..', 'app');

const approvals = readFileSync(join(APP_ROOT, '(parent)', 'approvals.tsx'), 'utf8');
const welcome = readFileSync(join(APP_ROOT, '(parent)', 'welcome.tsx'), 'utf8');

describe('the prompt fires from a granted approval', () => {
  it('approvals.tsx imports the bridge', () => {
    expect(approvals).toMatch(
      /import\s*\{[^}]*\bnoteApprovalGranted\b[^}]*\}\s*from\s*['"]@\/lib\/reviewPrompt['"]/
    );
  });

  it('calls it only when the decision was an approval', () => {
    // A rejection is a child being told to do it again. Asking that parent to rate the app is the
    // worst possible moment, and it is one character away from being the code that ships.
    expect(approvals).toMatch(/if\s*\(variables\.approved\)\s*void noteApprovalGranted\(\)/);
  });

  it('does not await it, so a rating prompt cannot delay the list refreshing', () => {
    expect(approvals).not.toMatch(/await\s+noteApprovalGranted\(/);
  });
});

describe('the setup wizard never asks', () => {
  it('welcome.tsx does not reach for the review prompt', () => {
    // Step 4 runs a real approval through the real pipeline, which is exactly why this needs saying:
    // it is a demonstration the parent was walked through sixty seconds after signing up, not
    // evidence the app is working for their family.
    expect(welcome).not.toContain('noteApprovalGranted');
    expect(welcome).not.toContain('reviewPrompt');
  });
});

describe('the native module stays behind the bridge', () => {
  it('is imported by reviewPrompt.ts and nothing else', () => {
    // Pulling expo-store-review into a screen or an api module repeats a mistake that has already
    // broken dozens of unrelated suites in this app once.
    const bridge = readFileSync(join(__dirname, '..', 'lib', 'reviewPrompt.ts'), 'utf8');
    const policy = readFileSync(join(__dirname, '..', 'lib', 'reviewPolicy.ts'), 'utf8');

    // Matching the import specifically, not the bare name: reviewPolicy.ts's header explains why it
    // stays clear of the native module, and that sentence is not an import.
    const imports = /from ['"]expo-store-review['"]/;

    expect(bridge).toMatch(imports);
    expect(policy).not.toMatch(imports);
    expect(approvals).not.toMatch(imports);
  });
});

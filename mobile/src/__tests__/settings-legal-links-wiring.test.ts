/**
 * The privacy policy, the terms, the deletion steps and the support address stay reachable when the
 * family settings request does not come back.
 *
 * Pinned as a source guard for the same reason `onboarding-wizard-wiring.test.ts` is: these are React
 * Native screens with no DOM to render against in a plain jest run, so the only place the structure is
 * visible as text is the source file itself.
 *
 * The regression this exists to catch is a quiet one. Folding the About card back in beside the
 * toggles would look tidier and would still render correctly every time a developer opened the screen
 * on a working connection. It would only fail for a parent who is offline or holding a broken session,
 * which is the parent most likely to be hunting for the support address in the first place, and it
 * would fail by showing them an error card where Play expects a privacy policy.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', '..', 'app', '(parent)', 'settings.tsx'), 'utf8');

/** The body of a top-level `function <name>(` declaration, up to the next one. */
function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);

  const rest = source.slice(start + 1);
  const next = rest.search(/\nfunction |\nexport default /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * `DELETE_ACCOUNT_URL` is deliberately NOT in this list any more.
 *
 * Deletion moved from an outbound link to an in-app screen, because Play's data-deletion policy
 * expects the account holder to be able to start deletion inside the app rather than be sent to a
 * page describing how to email us. The web page is still published for anyone who has uninstalled;
 * it is simply no longer what this row opens. See the in-app route assertions below.
 */
const LINK_NAMES = [
  'PRIVACY_URL',
  'TERMS_URL',
  'supportMailto',
  'playListingUrls',
  'openFirstAvailable',
  'SUPPORT_EMAIL',
];

describe('settings.tsx pulls its outbound links from the shared module', () => {
  it.each(LINK_NAMES)('imports %s from @/lib/externalLinks', (name) => {
    // Not a hardcoded URL in the screen: externalLinks.ts is the file whose test checks these against
    // the pages marketing/build.mjs actually generates.
    expect(source).toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]@/lib/externalLinks['"]`, 's')
    );
  });

  it('has no gettaskbuddy.com URL or address of its own', () => {
    // Including the fallback toast that names the support inbox: one literal, in one file.
    expect(source).not.toMatch(/gettaskbuddy\.com/);
  });
});

describe('the legal links do not sit behind the settings query', () => {
  it('keeps every outbound link out of the query-gated component', () => {
    // FamilyPreferences owns `useQuery` and returns early on pending and on error. Anything inside it
    // is unreachable in exactly the states where these links matter most.
    const gated = functionBody('FamilyPreferences');

    expect(gated).toContain('useQuery(settingsQuery())');
    for (const name of LINK_NAMES) {
      expect(gated).not.toContain(name);
    }
  });

  it('opens account deletion in the app, not the browser', () => {
    const ungated = functionBody('SupportAndAbout');

    // The row must push the in-app route. A regression to `open([DELETE_ACCOUNT_URL])` would look
    // identical on screen and would put the app back out of policy.
    expect(ungated).toContain("router.push('/(parent)/delete-account')");
    expect(ungated).not.toContain('DELETE_ACCOUNT_URL]');
  });

  it('renders the links from a component that fetches nothing', () => {
    const ungated = functionBody('SupportAndAbout');

    expect(ungated).toContain('PRIVACY_URL');
    expect(ungated).not.toContain('useQuery');
  });

  it('mounts both sections as siblings, so neither can gate the other', () => {
    expect(source).toMatch(/<FamilyPreferences \/>\s*<SupportAndAbout \/>/);
  });
});

/**
 * A notification must open the thing it is about.
 *
 * Reported: "when I click on a notification, it does not open the item" — and specifically, a
 * comment notification should open the comment. Both notification surfaces navigate with
 * `router.push(n.actionUrl)`, so the whole mechanism is the URL the server puts on the row. The
 * server now sends `/child/tasks?assignment=<id>`; this file guards the half that lives here, which
 * is that the page does something with the id instead of ignoring it.
 *
 * A source guard, matching the backend's `notification-destinations` test: the failure mode is an
 * omission (the query string arrives and nothing reads it), and there is no rendering test harness
 * in this workspace to assert it any other way.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE = readFileSync(
  join(__dirname, '..', 'src', 'app', 'child', 'tasks', 'page.tsx'),
  'utf8'
);

describe('child tasks page: ?assignment= deep link', () => {
  it('reads the assignment id from the query string', () => {
    // Via `useSearchParams()`, deliberately, and NOT via a mount-time read of
    // `window.location.search` — see the "already on the page" test below for why that mattered.
    expect(PAGE).toMatch(/const searchParams = useSearchParams\(\)/);
    expect(PAGE).toMatch(/searchParams\.get\('assignment'\)/);
  });

  it('picks the tab from the assignment status, so the card is not on a hidden tab', () => {
    // The three tabs split on status, and a linked assignment is as likely to be Returned or
    // Completed as Active. Landing on the default tab shows an empty list and reads as a bug.
    expect(PAGE).toMatch(/function tabForStatus/);
    expect(PAGE).toMatch(/setActiveTab\(tabForStatus\(/);
  });

  it('gives every card an anchor the deep link can scroll to', () => {
    // All three lists, not just the active one — the id in the URL is just an assignment id and the
    // server does not know which tab it will be filed under by the time the child taps.
    expect(PAGE).toMatch(/id=\{`assignment-\$\{assignmentId\}`\}/);
    const wrapped = PAGE.match(/<DeepLinkTarget /g) ?? [];
    expect(wrapped.length).toBe(3);
  });

  it('scrolls the linked card into view', () => {
    expect(PAGE).toMatch(/getElementById\(`assignment-\$\{focused\.id\}`\)/);
    expect(PAGE).toMatch(/scrollIntoView/);
  });
});

/**
 * Reported after the deep link shipped: "clicking on the notification item does not send me to the
 * task approved. i have to go to another tab then when i click on the notification item, it now
 * sends me to the item i clicked."
 *
 * Both notification surfaces navigate with `router.push(n.actionUrl)`. When the child is ALREADY on
 * /child/tasks, that pushes the same route with a different query, and Next does not remount a page
 * for a query change. The old code read the param in a `useEffect` with an empty dependency array,
 * so nothing re-ran and the click did nothing. Leaving the page and coming back remounted it, which
 * is exactly the workaround that was reported.
 */
describe('the deep link works while already on the page', () => {
  it('does not read the query string in a mount-only effect', () => {
    // The specific shape of the bug. A `[]`-deps effect cannot observe a query change.
    expect(PAGE).not.toMatch(/URLSearchParams\(window\.location\.search\)/);
    expect(PAGE).not.toMatch(/setFocusedId/);
  });

  it('derives the highlighted id from the URL rather than copying it into state', () => {
    // Copying to state reintroduces the bug the moment the copy happens only once.
    expect(PAGE).toMatch(/const focusedId = searchParams\.get\('assignment'\)/);
  });

  it('clears the param when the highlight ends, so the same notification can be clicked twice', () => {
    // If the id stayed in the URL, a second click would push a URL identical to the current one,
    // which is not a navigation and produces no signal at all.
    expect(PAGE).toMatch(/router\.replace\('\/child\/tasks', \{ scroll: false \}\)/);
  });

  it('sits under a Suspense boundary, which useSearchParams requires', () => {
    expect(PAGE).toMatch(/<Suspense/);
    expect(PAGE).toMatch(/function ChildTasksInner/);
  });
});

describe('the parent list follows ?tab= too', () => {
  it('reacts to the param changing, not just to the first render', () => {
    // Same class: the weekly digest links a parent to /parent/tasks?tab=pending, and a parent
    // already on that page stayed on whatever tab they were looking at.
    const parent = readFileSync(
      join(__dirname, '..', 'src', 'app', 'parent', 'tasks', 'page.tsx'),
      'utf8'
    );

    expect(parent).toMatch(/useEffect\(\(\) => \{\s*if \(urlTab\) setActiveTab\(urlTab\);\s*\}, \[urlTab\]\)/);
  });
});

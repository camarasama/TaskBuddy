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
    expect(PAGE).toMatch(/URLSearchParams\(window\.location\.search\)\.get\('assignment'\)/);
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

/**
 * Every in-app notification must be clickable.
 *
 * Reported: clicking a notification on the web "does not open the item". Both surfaces — the bell
 * dropdown and the notifications page — navigate only when `actionUrl` is present:
 *
 *     if (n.actionUrl) router.push(n.actionUrl);
 *
 * So a notification created without one is silently inert. Nothing errors, nothing logs, the row
 * just does not respond. Four of them shipped that way: task_archived, task_expired (both the child
 * and parent copies) and task_expiring.
 *
 * A source guard rather than a runtime test: the failure is an omission at the call site, and that
 * is what has to be prevented. Reading the sources catches it wherever a new call is added, which a
 * test of any single route would not.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Each `createNotification({ ... })` call, as source text. */
function notificationCalls(): { file: string; body: string; type: string }[] {
  const calls: { file: string; body: string; type: string }[] = [];

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    let index = source.indexOf('createNotification({');
    while (index !== -1) {
      // Balanced-brace scan from the opening `{`, so nested objects do not truncate the body.
      const start = source.indexOf('{', index);
      let depth = 0;
      let end = start;
      for (let i = start; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      const body = source.slice(start, end + 1);
      const type = /notificationType:\s*'([a-z_]+)'/.exec(body)?.[1];
      if (type) calls.push({ file: file.replace(`${SRC}/`, ''), body, type });
      index = source.indexOf('createNotification({', end);
    }
  }
  return calls;
}

describe('createNotification call sites', () => {
  const calls = notificationCalls();

  it('finds the call sites at all, so a passing run is not an empty one', () => {
    // Without this, a refactor that renames the helper would make every assertion below vacuous.
    expect(calls.length).toBeGreaterThan(8);
  });

  it('every notification carries an actionUrl, or it is unclickable', () => {
    const missing = calls
      .filter((c) => !/actionUrl:/.test(c.body))
      .map((c) => `${c.type} (${c.file})`);

    expect(missing).toEqual([]);
  });

  /**
   * A notification about ONE assignment has to name it.
   *
   * Reported: "if the notification is about a comment, then when clicking on the notification, it
   * should open the comment". The comment thread is rendered inside that assignment's own card, on
   * one tab of three, so `/child/tasks` alone leaves the child hunting. `?assignment=<id>` is what
   * the page reads to pick the tab and scroll to the card.
   *
   * `task_archived` is excluded on purpose and is the reason this is an allow-list rather than a
   * blanket rule: its assignment has just been expired, so the card the link would point at is not
   * rendered on any tab.
   */
  it('deep-links every notification that is about a single assignment', () => {
    const PER_ASSIGNMENT = [
      'task_assigned',
      'task_submitted',
      'task_approved',
      'task_rejected',
      'task_comment',
    ];

    const perAssignment = calls.filter((c) => PER_ASSIGNMENT.includes(c.type));
    // A floor, so renaming a notification type cannot turn this into an assertion about nothing.
    expect(perAssignment.length).toBeGreaterThanOrEqual(5);

    const shallow = perAssignment
      .filter((c) => {
        const url = /actionUrl:\s*[`']([^`']+)/.exec(c.body)?.[1] ?? '';
        return url.startsWith('/child/tasks') && !url.includes('?assignment=');
      })
      .map((c) => `${c.type} (${c.file})`);

    expect(shallow).toEqual([]);
  });

  it('never sends a parent to a /child route or a child to a /parent route', () => {
    // A parent following /child/tasks hits a route they cannot view. This caught nothing at the time
    // of writing, and exists because the two copies of task_expired differ ONLY in recipient — the
    // easiest possible place to paste the wrong path.
    const wrong = calls
      .filter((c) => {
        const url = /actionUrl:\s*[`']([^`']+)/.exec(c.body)?.[1] ?? '';
        const toParent = /userId:\s*(p|parent)\b/.test(c.body);
        return (toParent && url.startsWith('/child/')) || (!toParent && url.startsWith('/parent/') && /userId:\s*a\.childId/.test(c.body));
      })
      .map((c) => `${c.type} (${c.file})`);

    expect(wrong).toEqual([]);
  });
});

/**
 * The child task detail page, guarded at the source.
 *
 * Asked for as: "add a task detail in web so child can see details of task assigned, returned tasks,
 * closed by him/herself and opened tasks unassigned". Those are four distinct things to open, and
 * two of them are the ones most likely to be quietly dropped: a returned task's reason, and a pool
 * task that has no assignment row to address at all.
 *
 * Source guards rather than rendering assertions, matching `notification-deep-link.test.ts`: this
 * workspace has no DOM test harness (jest runs in `node`), and the failure mode being guarded is an
 * omission, not a wrong value.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');
const DETAIL = readFileSync(join(SRC, 'app', 'child', 'tasks', '[id]', 'page.tsx'), 'utf8');
const LIST = readFileSync(join(SRC, 'app', 'child', 'tasks', 'page.tsx'), 'utf8');
const MODAL = readFileSync(join(SRC, 'components', 'tasks', 'PhotoUploadModal.tsx'), 'utf8');

describe('child task detail: what it must show', () => {
  it('never calls the parent-only single-assignment endpoint', () => {
    // GET /tasks/assignments/:id is requireParent. A child hitting it gets a 403, and widening it
    // would put a child-reachable path on a parent-scoped route.
    expect(DETAIL).not.toMatch(/getAssignmentById|assignments\/\$\{/);
    expect(DETAIL).toMatch(/tasksApi\.getMyAssignments\(/);
  });

  it('pages forward through history instead of giving up after page one', () => {
    // A task from last month is not on page one, and "not loaded yet" must never render as
    // "we couldn't find that task".
    expect(DETAIL).toMatch(/MAX_PAGES/);
    expect(DETAIL).toMatch(/pagination\?\.hasMore/);
  });

  it('resolves a pool task by task id when the segment is not an assignment', () => {
    // The fourth case in the request: "opened tasks unassigned". Those have no assignment row.
    expect(DETAIL).toMatch(/kind: 'pool'/);
    expect(DETAIL).toMatch(/tasksApi\.selfAssign\(/);
  });

  it('shows the rejection reason on a returned task', () => {
    // The whole point of opening a returned task. The list only ever showed it in passing.
    expect(DETAIL).toMatch(/rejectionReason/);
    expect(DETAIL).toMatch(/What to fix/);
  });

  it('offers no actions on a finished task', () => {
    // A completed or approved assignment is a thing to read. Guarded because the natural way to
    // write this page is one action block for every state.
    expect(DETAIL).toMatch(/isFinished\s*=\s*\['completed', 'approved'\]\.includes\(status\)/);
    expect(DETAIL).toMatch(/!isFinished && !isExpired/);
  });

  it('uploads evidence BEFORE completing, and not at all if the upload throws', () => {
    // Completing first would leave a photo-required task looking finished to a parent with no
    // photo attached, which is worse than not submitting.
    const upload = DETAIL.indexOf('uploadEvidence');
    const complete = DETAIL.indexOf('completeAssignment(assignment.id, evidence?.fileUrl)');
    expect(upload).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(upload);
  });

  it('hides an archived task rather than offering a dead Start button', () => {
    expect(DETAIL).toMatch(/status === 'archived'/);
  });
});

describe('child tasks list: the way in', () => {
  it('links every card type to the detail page', () => {
    // Four card types: active, completed, returned, and the unclaimed pool.
    const links = LIST.match(/<DetailLink /g) ?? [];
    expect(links.length).toBe(4);
  });

  it('links the pool card by task id, not assignment id', () => {
    expect(LIST).toMatch(/<DetailLink taskId=\{task\.id\}/);
  });

  it('does not wrap a whole card in the link', () => {
    // Every card holds buttons and a comment thread; a mis-tap on Start must not navigate.
    expect(LIST).not.toMatch(/<Link[^>]*>\s*<motion\.div/);
  });

  it('still reads the ?assignment= deep link', () => {
    // The server sends /child/tasks?assignment=<id> and nothing in this change alters that
    // contract, so the list must keep honouring it. How it reads the param is pinned in
    // notification-deep-link.test.ts; this only asserts that it still does.
    expect(LIST).toMatch(/searchParams\.get\('assignment'\)/);
  });
});

describe('photo evidence modal', () => {
  it('is shared, not copied', () => {
    expect(LIST).toMatch(/from '@\/components\/tasks\/PhotoUploadModal'/);
    expect(DETAIL).toMatch(/from '@\/components\/tasks\/PhotoUploadModal'/);
    // The definition lives in exactly one place now.
    expect(LIST).not.toMatch(/^function PhotoUploadModal/m);
    expect(MODAL).toMatch(/^export function PhotoUploadModal/m);
  });
});

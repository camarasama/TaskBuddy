/**
 * A child must be able to open a task, on both tabs.
 *
 * Reported: "as a child, I cannot open closed tasks and to-do tasks, both from the home tab and from
 * the task tab" — while the same thing worked as a parent. It was not a fault: the home-tab row was a
 * plain `View` with no press handler, the tasks-tab row exposed only the tick and Start, and the
 * child shell had no task screen to open. The parent shell has had `task-detail` all along.
 *
 * Source guards, matching the rest of this suite: the failure mode is an omission (a row that is not
 * pressable, a screen that does not exist), which is exactly what reading the source catches.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

const DETAIL = read('(child)', 'task-detail.tsx');

describe('both child task rows open the task', () => {
  it('the home tab row is pressable and routes to the detail screen', () => {
    const dashboard = read('(child)', 'dashboard.tsx');

    expect(dashboard).toMatch(/<Pressable/);
    expect(dashboard).toMatch(/pathname: '\/\(child\)\/task-detail'/);
    expect(dashboard).toMatch(/params: \{ assignment: assignment\.id \}/);
  });

  it('the tasks tab row is pressable and routes to the detail screen', () => {
    const tasks = read('(child)', 'tasks.tsx');

    expect(tasks).toMatch(/pathname: '\/\(child\)\/task-detail'/);
    expect(tasks).toMatch(/params: \{ assignment: item\.id \}/);
  });

  /**
   * Reported later, about a bonus task: "I can see it in child as available but cannot open to see
   * detail. Completed task, I can see details but active no." The Available section lives inside the
   * Active segment, and its rows were the one place in the app showing a task you could not open.
   */
  it('an unclaimed pool task opens too, addressed by TASK id', () => {
    const tasks = read('(child)', 'tasks.tsx');

    // Nobody has claimed it, so there is no assignment id to point at.
    expect(tasks).toMatch(/params: \{ task: task\.id \}/);
    // The Pressable must wrap AvailableRow's card, not only the claim button.
    expect(tasks).toMatch(/<Pressable[\s\S]{0,300}?params: \{ task: task\.id \}[\s\S]{0,400}?<Card>/);
  });

  it('the detail screen resolves a pool task separately from an assignment', () => {
    expect(DETAIL).toMatch(/task\?: string;/);
    expect(DETAIL).toMatch(/if \(poolTaskId\) \{/);
    // And offers the one action a pool task affords.
    expect(DETAIL).toMatch(/label="Pick this up"/);
  });

  it('does not page the whole assignment history looking for a task id', () => {
    // A pool id is a TASK id and will never match an assignment, so the walk must be skipped.
    expect(DETAIL).toMatch(/if \(poolTaskId \|\| assignment \|\| !mine\.hasNextPage/);
  });

  it('keeps the tick and Start on the row, so finishing from the list still works', () => {
    // Opening a task must not become the only way to say "done" — that would add a screen to the
    // shortest path in the app.
    const tasks = read('(child)', 'tasks.tsx');

    expect(tasks).toMatch(/<TaskTick[\s\S]{0,200}onPress=\{onComplete\}/);
    expect(tasks).toMatch(/label="Start"/);
  });
});

describe('the child task detail screen', () => {
  it('shows why a task was sent back, which no child screen has ever shown', () => {
    expect(DETAIL).toMatch(/assignment\.rejectionReason/);
  });

  it('lets an open task be started and submitted, with an optional note and photo', () => {
    expect(DETAIL).toMatch(/doStart\(assignment\.id\)/);
    expect(DETAIL).toMatch(/doComplete\(\{ id: assignment\.id, text: note \}\)/);
    expect(DETAIL).toMatch(/uploadEvidence\(assignment\.id, chosen\)/);
  });

  it('uploads the photo BEFORE submitting, and abandons the submit if it fails', () => {
    // A photo-required task submitted with the photo silently dropped looks finished to a parent,
    // which is worse than not submitting at all.
    const submit = DETAIL.slice(DETAIL.indexOf('async function submit'));
    const upload = submit.indexOf('uploadEvidence');
    const complete = submit.indexOf('doComplete');

    expect(upload).toBeGreaterThan(-1);
    expect(upload).toBeLessThan(complete);
    expect(submit).toMatch(/await uploadEvidence/);
  });

  it('offers no action on a finished task — it is a thing to read', () => {
    expect(DETAIL).toMatch(/\{!done && status !== 'expired' &&/);
  });

  it('reads the assignment from the list query, because the by-id endpoint is parent-only', () => {
    // `GET /tasks/assignments/:id` is `requireParent`. Widening it for this screen would put a
    // parent-scoped route in reach of a child session.
    expect(DETAIL).toMatch(/useInfiniteQuery\(myAssignmentsQuery\(\)\)/);
    // And it must page forward, or an assignment from last week reads as "not found".
    expect(DETAIL).toMatch(/mine\.fetchNextPage\(\)/);
  });

  it('shows the evidence photo full screen, the same as the parent side', () => {
    expect(DETAIL).toMatch(/<PhotoViewer uri=\{viewingPhoto\}/);
  });
});

describe('the child tasks screen mirrors the web', () => {
  const TASKS = read('(child)', 'tasks.tsx');

  it('uses the web wording, so one child on two devices sees one app', () => {
    // "To do"/"Done" against the web's "Active"/"Completed" read as two different products.
    expect(TASKS).toMatch(/\{ key: 'active', label: 'Active' \}/);
    expect(TASKS).toMatch(/\{ key: 'completed', label: 'Completed' \}/);
    expect(TASKS).toMatch(/\{ key: 'returned', label: 'Returned' \}/);
  });

  it('has no Available segment — claimable tasks sit under Active as they do on the web', () => {
    expect(TASKS).not.toMatch(/label: 'Available'/);
    expect(TASKS).not.toMatch(/'available'/);
    expect(TASKS).toMatch(/Available tasks/);
  });
});

describe('task-detail is reachable but is not a tab', () => {
  it('is registered with href: null, or expo-router gives it one', () => {
    // ⚠️ Shipped once as a stray "task-detail" tab in the child tab bar. Omitting the <Tabs.Screen>
    // does NOT hide it — expo-router adds a default tab for every route in the group.
    const layout = read('(child)', '_layout.tsx');

    expect(layout).toMatch(/<Tabs\.Screen name="task-detail" options=\{\{ href: null \}\} \/>/);
  });
});

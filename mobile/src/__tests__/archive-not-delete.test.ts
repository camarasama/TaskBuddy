/**
 * Mobile withdraws a task by ARCHIVING it, the way the web always has.
 *
 * Reported: "on a parent dashboard in portal, tasks are not deleted but archived, the same process is
 * not mirrored on mobile. in mobile, when you edit a task, there is a button to delete."
 *
 * The two are not the same operation, which is what made this worth fixing rather than renaming:
 *
 *   web    Archive  -> PUT /tasks/:id { status: 'archived' }, restorable from its own list
 *   mobile Delete   -> DELETE /tasks/:id, stamps `deletedAt`, and every list query filters on
 *                      `deletedAt: null`, so the task leaves BOTH apps with no route back
 *
 * Source guards, matching the rest of this suite: every failure mode below is an omission or a
 * leftover (a button that is still there, an endpoint still reachable, a tab still named Paused).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', '..', 'app');
const LIB = join(__dirname, '..', 'lib');
const read = (base: string, ...p: string[]) => readFileSync(join(base, ...p), 'utf8');

const FORM = read(APP, '(parent)', 'task-form.tsx');
const LIST = read(APP, '(parent)', 'tasks.tsx');
const DETAIL = read(APP, '(parent)', 'task-detail.tsx');
const LAYOUT = read(APP, '_layout.tsx');
const WRITE_API = read(LIB, 'parentWriteApi.ts');

describe('the edit form offers only Save and Cancel', () => {
  it('has no delete button', () => {
    expect(FORM).not.toMatch(/label="Delete task"/);
    expect(FORM).not.toMatch(/label="Delete"/);
  });

  it('keeps both of the buttons that should be there', () => {
    expect(FORM).toMatch(/label=\{editing \? 'Save changes' : 'Create task'\}/);
    expect(FORM).toMatch(/label="Cancel"/);
  });

  it('no longer imports or calls the delete endpoint', () => {
    expect(FORM).not.toMatch(/deleteTask/);
  });
});

describe('DELETE /tasks/:id is unreachable from the app', () => {
  it('is not called from anywhere', () => {
    // The endpoint still exists on the server. Nothing here may call it: a soft delete cannot be
    // undone from either app.
    for (const [name, source] of [
      ['task-form', FORM],
      ['tasks list', LIST],
      ['task-detail', DETAIL],
      ['parentWriteApi', WRITE_API],
    ] as const) {
      expect([name, /api\.delete\(`\/tasks\/\$\{id\}`\)/.test(source)]).toEqual([name, false]);
    }
  });

  it('exports archive and restore instead, both through PUT', () => {
    expect(WRITE_API).toMatch(/export function archiveTask[\s\S]{0,200}status: 'archived'/);
    expect(WRITE_API).toMatch(/export function restoreTask[\s\S]{0,200}status: 'active'/);
    expect(WRITE_API).not.toMatch(/export function deleteTask/);
  });
});

describe('the task list', () => {
  it('offers Archive on a live task and Restore on an archived one', () => {
    expect(LIST).toMatch(/label="Archive"/);
    expect(LIST).toMatch(/label="Restore"/);
    expect(LIST).toMatch(/item\.status === 'archived'/);
  });

  it('confirms before archiving, and does not confirm a restore', () => {
    // Archiving takes the task off a child's list straight away and a swipe is easy to start by
    // accident. Restoring only ever puts something back.
    expect(LIST).toMatch(/Archive \{confirming\?\.title\}\?/);
    expect(LIST).toMatch(/const onRestore[\s\S]{0,200}restore\.mutate/);
  });

  it('has the four tabs, and Paused is not one of them', () => {
    // "I can see Pause, there is no such thing as pause tasks, the pause tab can be renamed
    // completed". `paused` stays a valid TaskStatus and stays settable on the web; it is only gone
    // from this app's chip row.
    const keys = [...LIST.matchAll(/\{ key: '(\w+)', label: '([\w ]+)'/g)].map((m) => [m[1], m[2]]);
    expect(keys).toEqual([
      ['all', 'All'],
      ['active', 'Active'],
      ['completed', 'Completed'],
      ['archived', 'Archived'],
    ]);
  });

  it('asks the SERVER for the Active/Completed split rather than filtering a loaded page', () => {
    // Filtering client-side would drop rows and report a `total` for a filter the server never
    // applied. Both tabs also pin status so an archived task cannot leak into either.
    expect(LIST).toMatch(/filters: \{ status: 'active', view: 'open' \}/);
    expect(LIST).toMatch(/filters: \{ status: 'active', view: 'done' \}/);
  });

  it('does not disable the row press while swiping', () => {
    // The row still opens the detail screen. A swipe action must not become the only thing a row
    // does, and it must not become the only way to reach Archive either.
    expect(LIST).toMatch(/pathname: '\/\(parent\)\/task-detail'/);
    expect(DETAIL).toMatch(/label=\{task\.status === 'archived' \? 'Restore' : 'Archive'\}/);
  });
});

describe('gesture handler is rooted', () => {
  it('wraps the app, because on Android a swipe silently does nothing without it', () => {
    expect(LAYOUT).toMatch(/<GestureHandlerRootView style=\{styles\.root\}>/);
    expect(LAYOUT).toMatch(/root: \{ flex: 1 \}/);
  });
});

/**
 * The child screens must react to what a PARENT does.
 *
 * Reported: a parent returned a submitted task, the notification bell lit up, and the child's
 * dashboard kept showing it as submitted until they signed out and back in.
 *
 * The server has always emitted `task:rejected` to `user:{childId}`. Nothing on the child side
 * listened. The bell updated because that is a different event (`notification:new`), which is
 * exactly why the two disagreed on screen and the bug read as "the page is stale" rather than "an
 * event is unhandled".
 *
 * A source-level assertion rather than a render test: what failed was a missing subscription, and
 * that is visible in the source without standing up sockets, a query client and an auth context.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('child dashboard', () => {
  const source = read('src/app/child/dashboard/page.tsx');

  it('subscribes to task:rejected, not only task:approved', () => {
    // Approval was handled from the start; a return was not, and a return is the one that asks the
    // child to do something again.
    expect(source).toContain("socket.on('task:approved'");
    expect(source).toContain("socket.on('task:rejected'");
  });

  it('unsubscribes from task:rejected on unmount', () => {
    // A listener left attached on every mount multiplies refetches per navigation.
    expect(source).toContain("socket.off('task:rejected'");
  });
});

describe('child tasks page', () => {
  const source = read('src/app/child/tasks/page.tsx');

  it('subscribes to both parent-driven task events', () => {
    // This page had NO socket subscriptions at all, and it is where the notification sends the
    // child (`actionUrl: '/child/tasks'`), so it was the most visible place to be stale.
    expect(source).toContain("socket.on('task:rejected'");
    expect(source).toContain("socket.on('task:approved'");
  });

  it('cleans both up', () => {
    expect(source).toContain("socket.off('task:rejected'");
    expect(source).toContain("socket.off('task:approved'");
  });
});

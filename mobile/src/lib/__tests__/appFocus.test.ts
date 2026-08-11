/**
 * Refetch-on-foreground.
 *
 * Regression: a parent returned a submitted task and the child's app kept showing it as submitted
 * until they signed out and back in. `refetchOnWindowFocus` is on by default but is a no-op in React
 * Native — it waits for a browser event that never fires — and the app has no socket client, so
 * nothing told the child anything had changed.
 *
 * Nothing observable failed, which is why this needs a test rather than a comment.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { isFocused, subscribeAppFocus } from '../appFocus';

/**
 * Spying on the real AppState rather than `jest.mock('react-native', …)`.
 *
 * A wholesale module mock breaks Expo's runtime setup, which reaches into react-native while
 * installing its fetch global — the suite then fails to load for reasons unrelated to what it tests.
 */
const listeners: ((status: AppStateStatus) => void)[] = [];
const remove = jest.fn();

beforeEach(() => {
  listeners.length = 0;
  remove.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, cb: (s: AppStateStatus) => void) => {
    listeners.push(cb);
    return { remove } as never;
  }) as never);
});

afterEach(() => jest.restoreAllMocks());

describe('isFocused', () => {
  it('treats only "active" as focused', () => {
    expect(isFocused('active')).toBe(true);
  });

  it('does NOT treat "inactive" as focused', () => {
    // iOS transitional state: app switcher, incoming call, notification shade. Counting it as
    // unfocused and then refocusing on the way back means a refetch every time someone swipes
    // between apps — a real cost on a metered connection for no new information.
    expect(isFocused('inactive')).toBe(false);
  });

  it('does not treat "background" as focused', () => {
    expect(isFocused('background')).toBe(false);
  });
});

describe('subscribeAppFocus', () => {
  it('reports focus regained when the app comes back to the foreground', () => {
    // This is the whole fix: without it the child never learns a parent returned their task.
    const handleFocus = jest.fn();

    subscribeAppFocus(handleFocus);
    listeners[0]('background');
    listeners[0]('active');

    expect(handleFocus).toHaveBeenNthCalledWith(1, false);
    expect(handleFocus).toHaveBeenNthCalledWith(2, true);
  });

  it('returns an unsubscribe that actually removes the listener', () => {
    // React Query calls this when it tears down. Leaking a listener per mount would fire the
    // handler repeatedly and multiply every refetch.
    const unsubscribe = subscribeAppFocus(jest.fn());

    unsubscribe();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});

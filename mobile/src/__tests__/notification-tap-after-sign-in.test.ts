/**
 * Tapping a push with the app closed opened a blank screen.
 *
 * The tap subscription lived in `RootLayout` and navigated while `Routes` was still rendering the
 * splash, before any navigator existed. It must subscribe from `Routes`, only once signed in, and a
 * foreground push must refetch what is on screen (reported: an approved task kept saying it was
 * waiting). Source guards, like the rest of this suite: both failures are a line in the wrong place.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const LAYOUT = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
const WATCHER = readFileSync(join(__dirname, '..', 'components', 'NotificationWatcher.tsx'), 'utf8');

const rootLayout = LAYOUT.slice(LAYOUT.indexOf('export default function RootLayout'));
const routes = LAYOUT.slice(LAYOUT.indexOf('function Routes'), LAYOUT.indexOf('export default function RootLayout'));

describe('notification taps wait for a signed-in navigator', () => {
  it('RootLayout no longer subscribes to taps', () => {
    expect(rootLayout).not.toMatch(/subscribeToNotificationTaps/);
  });

  it('Routes subscribes, gated on signedIn, before the splash return', () => {
    const subscribeAt = routes.indexOf('subscribeToNotificationTaps');
    expect(subscribeAt).toBeGreaterThan(-1);
    expect(routes.slice(0, subscribeAt)).toMatch(/if \(!signedIn\) return;/);
    expect(subscribeAt).toBeLessThan(routes.indexOf("if (status === 'loading') return <Splash />"));
  });
});

describe('an arriving notification refreshes what is on screen', () => {
  it('a foreground push invalidates queries', () => {
    expect(routes).toMatch(/subscribeToNotificationsReceived\(\(\) => void queryClient\.invalidateQueries\(\)\)/);
  });

  it('the unread-count watcher does too, for phones that refused push', () => {
    expect(WATCHER).toMatch(/queryClient\.invalidateQueries\(\)/);
  });
});

/**
 * The X-Client header is a cross-package contract, and a silent one.
 *
 * If the app sends a value the backend cannot parse, the backend does not reject the request — it
 * treats the caller as a browser and delivers the refresh token as a cookie the app can never
 * read. Everything appears to work until the app is restarted, at which point the user is
 * logged out with no error anywhere. That failure is expensive to trace backwards, so it is
 * pinned here at the cheapest possible point.
 */

// The app config isn't evaluated under jest, so `extra` is supplied directly.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.gettaskbuddy.com/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

/**
 * Copied verbatim from backend/src/utils/client.ts. Duplication is deliberate: importing across
 * workspaces would make this test pass by construction, which is precisely what it must not do.
 * If the backend grammar changes, this copy must change with it.
 */
const BACKEND_PATTERN =
  /^([a-z0-9][a-z0-9-]{0,31})\/(\d{1,5}\.\d{1,5}\.\d{1,5})(?:[-+][0-9A-Za-z.-]{1,32})?$/;

// `require`, not dynamic `import`: jest runs these as CJS, and `import()` needs
// --experimental-vm-modules. Both forms are needed anyway — the last test re-imports the module
// under a different mock, which only works with a synchronous require after resetModules().
/* eslint-disable @typescript-eslint/no-require-imports */

describe('X-Client header', () => {
  it('matches the grammar the backend parses', () => {
    const { CLIENT_HEADER } = require('../config');
    expect(CLIENT_HEADER).toMatch(BACKEND_PATTERN);
  });

  it('names a platform the backend treats as mobile', () => {
    const { CLIENT_PLATFORM } = require('../config');
    // MOBILE_PLATFORMS in backend/src/utils/client.ts. An unrecognised platform parses fine and
    // is then treated as web — the silent failure described above.
    expect(['taskbuddy-android', 'taskbuddy-ios']).toContain(CLIENT_PLATFORM);
  });

  it('uses an absolute API base — a relative path is meaningless on a device', () => {
    const { API_URL } = require('../config');
    expect(API_URL).toMatch(/^https?:\/\//);
  });
});

describe('missing config', () => {
  /**
   * Reports the problem WITHOUT throwing. Throwing during module evaluation kills a React Native
   * app before any error boundary or LogBox exists: the app closes back to the Expo Go home
   * screen with nothing on the phone and nothing in the Metro terminal. An earlier version of
   * config.ts threw here, and that is precisely how it presented.
   */
  it('reports missing values instead of throwing', () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));

    const config = require('../config');

    expect(config.CONFIG_ERRORS).toEqual(
      expect.arrayContaining([expect.stringContaining('apiUrl')])
    );
    // Still importable, so the screen can render and show the error.
    expect(config.API_URL).toContain('unconfigured');
  });

  it('flags a null manifest rather than dereferencing it', () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

    const config = require('../config');

    expect(config.CONFIG_ERRORS).toEqual(
      expect.arrayContaining([expect.stringContaining('expoConfig is null')])
    );
  });
});

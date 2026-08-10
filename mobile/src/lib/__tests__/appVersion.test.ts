/**
 * The app version, and the one way it can silently go wrong.
 *
 * `version` is what Play shows and what the version badge reads. `extra.clientVersion` is what goes
 * out as `X-Client: taskbuddy-android/<version>` on every request, and what the P0-2 force-upgrade
 * gate compares against `MOBILE_MIN_VERSION_ANDROID` server-side (`backend/src/utils/client.ts`).
 *
 * They were two separate literals until 2026-08-10. Nothing failed when they disagreed: the app kept
 * working, the badge kept showing the real version, and the server just made upgrade decisions about
 * a version the app was not. A bug with a delay on it, and invisible in every test that existed.
 *
 * Both now read one constant, and this asserts they still do. It reads the evaluated config rather
 * than the source, because the point is what ships, not what was written.
 */
import appConfig from '../../../app.config';

type Extra = { clientVersion?: string; clientPlatform?: string };

const config = appConfig({ config: {} } as never) as unknown as {
  version?: string;
  extra?: Extra;
};

describe('app version', () => {
  it('ships the same version to Play and to the X-Client header', () => {
    expect(config.extra?.clientVersion).toBe(config.version);
  });

  it('is semver, because the server orders it against a minimum', () => {
    // `compareVersions` splits on dots and compares numerically. A tag like "1.0.0-beta" or a bare
    // "1.0" would order in ways nobody intends, and the failure is a wrongly forced upgrade.
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports the platform the backend keys token delivery off', () => {
    // Not cosmetic: a malformed X-Client is treated as a browser, and the refresh token then goes to
    // a cookie the app cannot read (see the note in lib/api.ts).
    expect(config.extra?.clientPlatform).toBe('taskbuddy-android');
  });
});

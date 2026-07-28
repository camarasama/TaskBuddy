import request from 'supertest';

/**
 * P0-2 — GET /meta/min-version is the force-upgrade lever: it lets a broken native build be
 * hard-blocked without waiting on a Play review. It must work unauthenticated, because the app
 * calls it at launch before it has a session.
 */
jest.mock('../src/services/database', () => ({
  prisma: { $queryRaw: jest.fn() },
}));

import { app } from '../src/index';
import { config } from '../src/config';
import { compareVersions, parseClientHeader } from '../src/utils/client';

const minVersion = config.mobile.minVersion as Record<string, string>;
const originalAndroidMin = minVersion['taskbuddy-android'];

describe('GET /meta/min-version', () => {
  afterEach(() => {
    minVersion['taskbuddy-android'] = originalAndroidMin;
  });

  it('is public and lists the floor for every native platform', async () => {
    const res = await request(app).get('/api/v1/meta/min-version');

    expect(res.status).toBe(200);
    expect(res.body.data.platforms).toEqual({
      'taskbuddy-android': expect.any(String),
      'taskbuddy-ios': expect.any(String),
    });
    // Nothing identified itself, so there is nothing to force-upgrade.
    expect(res.body.data.client).toBeNull();
    expect(res.body.data.upgradeRequired).toBe(false);
  });

  it('flags a build below the floor', async () => {
    minVersion['taskbuddy-android'] = '2.0.0';

    const res = await request(app)
      .get('/api/v1/meta/min-version')
      .set('X-Client', 'taskbuddy-android/1.9.9');

    expect(res.status).toBe(200);
    expect(res.body.data.client).toEqual({ platform: 'taskbuddy-android', version: '1.9.9' });
    expect(res.body.data.upgradeRequired).toBe(true);
  });

  it.each(['2.0.0', '2.0.1', '10.0.0'])('accepts %s when the floor is 2.0.0', async (version) => {
    minVersion['taskbuddy-android'] = '2.0.0';

    const res = await request(app)
      .get('/api/v1/meta/min-version')
      .set('X-Client', `taskbuddy-android/${version}`);

    expect(res.body.data.upgradeRequired).toBe(false);
  });

  it('never blocks a client it cannot identify', async () => {
    minVersion['taskbuddy-android'] = '2.0.0';

    const res = await request(app)
      .get('/api/v1/meta/min-version')
      .set('X-Client', 'taskbuddy-android/garbage');

    expect(res.body.data.client).toBeNull();
    expect(res.body.data.upgradeRequired).toBe(false);
  });
});

describe('parseClientHeader', () => {
  it.each([
    ['taskbuddy-android/1.0.0', { platform: 'taskbuddy-android', version: '1.0.0' }],
    ['TaskBuddy-Android/1.0.0', { platform: 'taskbuddy-android', version: '1.0.0' }],
    ['  taskbuddy-ios/12.3.45  ', { platform: 'taskbuddy-ios', version: '12.3.45' }],
    // A prerelease suffix is accepted for dev builds, and ignored for ordering.
    ['taskbuddy-android/1.0.0-beta.2', { platform: 'taskbuddy-android', version: '1.0.0' }],
  ])('parses %s', (raw, expected) => {
    expect(parseClientHeader(raw)).toEqual(expected);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no version', 'taskbuddy-android'],
    ['two-part version', 'taskbuddy-android/1.0'],
    ['non-numeric version', 'taskbuddy-android/one.two.three'],
    ['embedded in a longer string', 'Mozilla/5.0 taskbuddy-android/1.0.0'],
    ['absurd version numbers', 'taskbuddy-android/999999.0.0'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientHeader(raw)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    // The case a string compare gets wrong: '10' < '9' alphabetically.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
  });
});

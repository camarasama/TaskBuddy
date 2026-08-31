/**
 * These links are compliance surface, not convenience. Three of them are cited on the Play listing
 * and the Data safety form, so the failure this file guards against is not a dead link, it is the app
 * and the store disagreeing about where the privacy policy lives.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Linking } from 'react-native';

import {
  DELETE_ACCOUNT_URL,
  openFirstAvailable,
  playListingUrls,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  supportMailto,
  TERMS_URL,
} from '@/lib/externalLinks';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('the pages these URLs point at are the ones the marketing site builds', () => {
  // Same shape of guard as appVersion.test.ts: two files have to agree, nothing breaks when they
  // stop agreeing, and the symptom appears weeks later in a Play review rather than in a test.
  const build = readFileSync(join(REPO_ROOT, 'marketing', 'build.mjs'), 'utf8');

  it.each([
    ['privacy policy', PRIVACY_URL],
    ['terms', TERMS_URL],
    ['account deletion', DELETE_ACCOUNT_URL],
  ])('%s is a route marketing/build.mjs generates', (_name, url) => {
    const path = new URL(url).pathname;
    expect(build).toContain(`link: '${path}'`);
  });

  it('points every page at the apex domain, which is what serves the marketing site', () => {
    for (const url of [PRIVACY_URL, TERMS_URL, DELETE_ACCOUNT_URL]) {
      expect(new URL(url).origin).toBe('https://gettaskbuddy.com');
    }
  });
});

describe('playListingUrls', () => {
  it('tries the Play app before the browser', () => {
    // Ordered rather than probed: from Android 11 `canOpenURL('market://...')` is false without a
    // <queries> manifest entry, so probing would claim no Play Store on a phone that has one.
    expect(playListingUrls('com.gettaskbuddy.app')).toEqual([
      'market://details?id=com.gettaskbuddy.app',
      'https://play.google.com/store/apps/details?id=com.gettaskbuddy.app',
    ]);
  });
});

describe('supportMailto', () => {
  it('addresses the support inbox and carries the build in the body', () => {
    const mailto = supportMailto({ version: '1.4.0', build: '12', platform: 'Android' });

    expect(mailto.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);

    const body = decodeURIComponent(new URL(mailto).searchParams.get('body') ?? '');
    expect(body).toContain('App: 1.4.0 (12)');
    expect(body).toContain('Platform: Android');
  });

  it('says "unknown" rather than "null" when there is no installed package to read', () => {
    // Expo Go and the web. "App: null" reads as a bug in the diagnostics, which is the one part of
    // the message that has to look trustworthy.
    const body = decodeURIComponent(
      new URL(supportMailto({ version: null, build: null, platform: 'Android' })).searchParams.get(
        'body'
      ) ?? ''
    );

    expect(body).toContain('App: unknown');
    expect(body).not.toContain('null');
  });

  it('percent-encodes the body, so the newlines survive the mail client', () => {
    const mailto = supportMailto({ version: '1.0.0', build: '1', platform: 'Android' });

    expect(mailto).toContain('%0A');
    // A raw newline or space in the query would be truncated or mangled by some Android clients.
    expect(mailto).not.toMatch(/[\n ]/);
  });
});

describe('openFirstAvailable', () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    /**
     * Reset explicitly rather than leaning on `jest.restoreAllMocks()`, which does not restore this
     * one: React Native exposes `Linking` through a getter, so the spy is never detached and the next
     * `spyOn` hands back the same mock with the previous test's calls still recorded on it. That
     * turns a call-count assertion into a test that passes or fails on execution order, which is the
     * kind of green that stops meaning anything.
     */
    openURL = jest.spyOn(Linking, 'openURL');
    openURL.mockReset();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('stops at the first URL the device can handle', async () => {
    openURL.mockResolvedValue(true);

    await expect(openFirstAvailable(['market://x', 'https://x'])).resolves.toBe(true);

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('market://x');
  });

  it('falls through to the next URL when a scheme has no handler', async () => {
    openURL.mockRejectedValueOnce(new Error('no activity found')).mockResolvedValueOnce(true);

    await expect(openFirstAvailable(['market://x', 'https://x'])).resolves.toBe(true);

    expect(openURL.mock.calls).toEqual([['market://x'], ['https://x']]);
  });

  it('reports failure rather than throwing when nothing can open any of them', async () => {
    // A de-Googled ROM with no browser is a normal device, not a crash report.
    openURL.mockRejectedValue(new Error('no activity found'));

    await expect(openFirstAvailable(['market://x', 'https://x'])).resolves.toBe(false);
    expect(openURL).toHaveBeenCalledTimes(2);
  });
});

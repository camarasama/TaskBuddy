/**
 * U5 — PWA app badge (growth roadmap §3.4).
 *
 * Support is genuinely patchy: the Badging API needs an INSTALLED PWA, iOS additionally needs
 * add-to-home-screen, and Firefox has no implementation. lib.dom declares the methods as always
 * present, which is a compile-time fiction — so every property here is about degrading silently
 * rather than about the happy path.
 */

import { setAppBadge, supportsAppBadge } from '../src/hooks/useAppBadge';

type NavShape = { setAppBadge?: unknown; clearAppBadge?: unknown };

const originalNavigator = globalThis.navigator;

function stubNavigator(nav: NavShape | undefined): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

describe('supportsAppBadge', () => {
  it('is false when the API is absent (Firefox, non-installed contexts)', () => {
    stubNavigator({});
    expect(supportsAppBadge()).toBe(false);
  });

  it('is false when setAppBadge is present but not callable', () => {
    // Guards against a polyfill that stubs the property with a non-function.
    stubNavigator({ setAppBadge: true });
    expect(supportsAppBadge()).toBe(false);
  });

  it('is true when the API is implemented', () => {
    stubNavigator({ setAppBadge: () => Promise.resolve() });
    expect(supportsAppBadge()).toBe(true);
  });
});

describe('setAppBadge', () => {
  it('sets the count when there is something pending', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    stubNavigator({ setAppBadge: set, clearAppBadge: jest.fn() });

    await setAppBadge(3);

    expect(set).toHaveBeenCalledWith(3);
  });

  it('CLEARS rather than showing a zero badge', async () => {
    // A "0" on the app icon reads as a bug to a user.
    const set = jest.fn();
    const clear = jest.fn().mockResolvedValue(undefined);
    stubNavigator({ setAppBadge: set, clearAppBadge: clear });

    await setAppBadge(0);

    expect(clear).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('does nothing at all when unsupported', async () => {
    stubNavigator({});
    await expect(setAppBadge(5)).resolves.toBeUndefined();
  });

  it('swallows a rejection rather than surfacing an OS refusal to a parent', async () => {
    stubNavigator({
      setAppBadge: jest.fn().mockRejectedValue(new Error('permission denied')),
    });
    await expect(setAppBadge(2)).resolves.toBeUndefined();
  });

  it('survives a browser that has setAppBadge but no clearAppBadge', async () => {
    // Optional-chained on purpose; a partial implementation must not throw on the zero path.
    stubNavigator({ setAppBadge: jest.fn() });
    await expect(setAppBadge(0)).resolves.toBeUndefined();
  });
});

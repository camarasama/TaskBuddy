/**
 * User-facing error text.
 *
 * The rate-limit case is here because the limiter's own message — "Too many requests" — reads as an
 * accusation and gives the user nothing to act on. The real cause is usually another device on the
 * same connection, since the limit is keyed on IP.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.test/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { ApiError, NetworkError, SessionExpiredError } =
  require('../api') as typeof import('../api');
const { describeError } = require('../errors') as typeof import('../errors');

describe('describeError', () => {
  it('explains a 429 with a wait time and the shared-connection cause', () => {
    const message = describeError(
      new ApiError('Too many requests', 429, 'RATE_LIMITED', [], 23)
    );

    expect(message).toContain('23 seconds');
    // The part that stops a parent thinking they did something wrong.
    expect(message).toContain('every device on your network');
    // Never the raw limiter text.
    expect(message).not.toBe('Too many requests');
  });

  it('rounds a longer wait into minutes', () => {
    const message = describeError(new ApiError('Too many requests', 429, undefined, [], 300));
    expect(message).toContain('5 minutes');
  });

  it('stays vague rather than inventing a number when Retry-After is missing', () => {
    const message = describeError(new ApiError('Too many requests', 429));
    expect(message).toContain('in a few minutes');
    expect(message).not.toMatch(/\d+ seconds/);
  });

  it('hides 5xx internals, which tell the user nothing actionable', () => {
    // Showing "Internal server error" invites a user to retype a password that was already correct.
    const message = describeError(new ApiError('Internal server error', 500));
    expect(message).toContain('our end');
    expect(message).not.toContain('Internal server error');
  });

  it('shows a 4xx message verbatim — it is the backend validation text', () => {
    expect(describeError(new ApiError('Invalid credentials', 401))).toBe('Invalid credentials');
  });

  it('passes through the errors that already carry user-ready messages', () => {
    expect(describeError(new NetworkError(new Error('boom')))).toContain('connection');
    expect(describeError(new SessionExpiredError())).toContain('sign in again');
  });

  it('falls back for something that is not an Error at all', () => {
    expect(describeError('a string')).toBe('Something went wrong. Please try again.');
  });
});

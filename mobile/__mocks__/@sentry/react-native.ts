/**
 * Automatic manual mock for the Sentry native module.
 *
 * Jest applies mocks in a root-level `__mocks__` directory to `node_modules` packages without any
 * `jest.mock()` call, so every suite gets this for free — which is the point. `reporting.ts` is
 * imported transitively by the API client and therefore by most suites, and loading the real
 * `@sentry/react-native` in all of them left timers running: jest started reporting "a worker
 * process has failed to exit gracefully" and the run went from ~7s to ~17s.
 *
 * Beyond the leak, a test suite must never be able to post events to a real ingest endpoint.
 */
export const init = jest.fn();
export const captureException = jest.fn();

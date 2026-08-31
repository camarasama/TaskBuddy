/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  /**
   * Raised from jest's 5s default because the first test in a file pays for transforming everything
   * that file imports, and on a cold cache that alone can exceed 5s: `Avatar.test.tsx` takes over six
   * seconds on a clean `--clearCache` run, and a test that mounts a provider tree takes longer still.
   *
   * The result was a suite that passed locally and failed on whichever runner happened to have no
   * cache, with a timeout pointing at a test that is not slow and had not changed. Nothing here
   * legitimately takes 30 seconds, so a real hang still fails, just not a cold start.
   */
  testTimeout: 30000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Same source-not-dist rule as metro.config.js — see the note there.
    '^@taskbuddy/shared$': '<rootDir>/../shared/src',
    /**
     * Pin React to mobile's own copy, exactly as metro.config.js does for the bundle.
     *
     * The web frontend needs React 18 and this app needs React 19, so npm keeps 18 at the repo root
     * and nests 19 under `mobile/`. Jest resolves like Node: a package hoisted to the ROOT walks up
     * from its own location and finds 18, while the renderer under `mobile/node_modules` is on 19.
     * `@tanstack/react-query` is hoisted, so any test rendering a component that calls `useQuery`
     * died with "Invalid hook call ... more than one copy of React", the same duplicate-React fault
     * metro.config.js already guards the device against, just never applied to the test runner.
     *
     * Without this, the only components that could be rendered in a test were the ones that fetch
     * nothing, which is why every existing component test is presentational.
     */
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^react-is$': '<rootDir>/node_modules/react-is',
  },
};

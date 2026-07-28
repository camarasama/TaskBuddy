/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Same source-not-dist rule as metro.config.js — see the note there.
    '^@taskbuddy/shared$': '<rootDir>/../shared/src',
  },
};

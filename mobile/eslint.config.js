/**
 * ESLint 9 flat config (2026-10-27), replacing .eslintrc.js.
 *
 * eslint-config-expo/flat needs the `eslint/config` subpath, which exists only in ESLint 9+. npm
 * hoists one eslint-config-expo to the repo root, so it resolves the ROOT eslint: mobile could only
 * move once backend and frontend did. The root package.json now pins eslint 9 for exactly that.
 */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['node_modules/', '.expo/', 'dist/'] },
  // React Compiler rules new in eslint-plugin-react-hooks 7. The ESLint 8 config never ran them, so
  // they are warnings for now: visible in every run, not blocking. Fixing them (mostly setState in
  // an effect) is its own follow-up, see the upgrade plan, not part of the ESLint 9 move.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);

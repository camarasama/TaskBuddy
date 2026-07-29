/**
 * Legacy (eslintrc) config, not flat config, on purpose.
 *
 * `eslint-config-expo/flat` requires the `eslint/config` subpath, which only exists in ESLint 9+.
 * Backend and frontend are on ESLint 8, and npm hoists a single copy of eslint-config-expo to the
 * repo root where it resolves against that 8 — so the flat entry throws before linting a line.
 *
 * Rather than run three ESLint majors in one repo, mobile uses the same 8 as everything else via
 * eslint-config-expo's legacy entry. Revisit when backend and frontend move to flat config; this
 * should move with them, not before them.
 */
module.exports = {
  root: true,
  extends: ['eslint-config-expo'],
  ignorePatterns: ['node_modules/', '.expo/', 'dist/'],
};

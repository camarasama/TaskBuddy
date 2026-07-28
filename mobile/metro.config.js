/**
 * Metro bundler config for the monorepo.
 *
 * Metro does not understand npm workspaces. Without `watchFolders` and `nodeModulesPaths` it
 * looks under `mobile/node_modules` only, and fails to resolve both hoisted packages and
 * `@taskbuddy/shared`.
 *
 * NOTE — `disableHierarchicalLookup` is deliberately NOT set, though most Expo monorepo guides
 * turn it on. Those guides assume Yarn or pnpm, which hoist completely. npm does not: it nests
 * a package's own dependencies (`mobile/node_modules/expo/node_modules/expo-asset`, and dozens
 * like it). Disabling hierarchical lookup pins Metro to the two paths below, and every one of
 * those nested modules then fails to resolve — verified here, one package at a time, before this
 * comment was written.
 *
 * The reason the guides recommend it is to prevent a duplicate React being bundled. That risk is
 * handled instead by `nodeModulesPaths` listing mobile's own directory first, so its React 19 is
 * found before the root's React 18 (which the marketing build depends on). If hooks ever start
 * failing with an error that points nowhere near the cause, check that ordering first.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Resolve `@taskbuddy/shared` to its TypeScript source rather than its build output.
 *
 * The package's `main` points at `shared/dist`, which is gitignored and produced by `tsc`. Going
 * through it would mean running `npm run build` before every mobile start and after every edit to
 * a shared file — miserable, and the kind of step that gets skipped until someone spends an hour
 * debugging a stale constant. Metro compiles TypeScript anyway, so pointing at source costs
 * nothing. The backend and web frontend still consume `dist` as before.
 */
config.resolver.extraNodeModules = {
  '@taskbuddy/shared': path.resolve(workspaceRoot, 'shared/src'),
};

module.exports = config;

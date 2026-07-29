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
 * The reason those guides recommend it is to prevent a duplicate React being bundled — a real risk
 * here, and `nodeModulesPaths` ordering alone did NOT prevent it (see the React pin below). The
 * two concerns are separated instead: hierarchical lookup stays ON globally so npm's nesting
 * resolves, and is disabled only for the React packages.
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

/**
 * Pin React to mobile's own copy.
 *
 * The web frontend needs React 18 and this app needs React 19, so they cannot both hoist: npm puts
 * 18 at the repo root and nests 19 under `mobile/`. That is correct on npm's part, but it means a
 * package hoisted to the ROOT — `@tanstack/react-query` is the one that bit us — resolves `react`
 * by walking up from its own location and finds 18, while app code finds 19. Two Reacts in one
 * bundle, and hooks fail at startup: on a device the app closes and returns to the Expo Go home
 * screen with no error, because it dies before anything can render one.
 *
 * `nodeModulesPaths` ordering does NOT prevent this — that list is consulted only after the
 * hierarchical walk from the importing file. Only these packages get the walk disabled, so npm's
 * nesting keeps working for everything else.
 *
 * `npx expo-doctor` will keep reporting "duplicate dependencies … react" regardless — it inspects
 * the dependency tree on disk, where both copies genuinely and correctly exist. That warning is
 * expected here and cannot be cleared without giving one of the two frontends the wrong React.
 * What matters is the BUNDLE, so verify it there:
 *
 *   npx expo export --platform android --output-dir /tmp/x --no-bytecode --clear
 *   grep -ohE '"(18|19)\.[0-9]+\.[0-9]+"' /tmp/x/_expo/static/js/android/*.js | sort -u
 *
 * Exactly one React version may appear. Two means this pin has stopped working.
 */
const REACT_PACKAGES = new Set(['react', 'react-is']);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const packageName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (REACT_PACKAGES.has(packageName)) {
    return context.resolveRequest(
      {
        ...context,
        disableHierarchicalLookup: true,
        nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
      },
      moduleName,
      platform
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

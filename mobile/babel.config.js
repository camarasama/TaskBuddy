/**
 * babel-preset-expo covers the expo-router transform and the `@/*` tsconfig path alias, so this
 * file stays deliberately empty of custom plugins. Anything added here has to be mirrored in
 * jest.config.js's transform, which is the usual reason mobile tests start failing for reasons
 * that have nothing to do with the test.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};

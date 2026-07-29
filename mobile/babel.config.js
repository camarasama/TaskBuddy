/**
 * babel-preset-expo covers the expo-router transform and the `@/*` tsconfig path alias.
 *
 * The worklets plugin is listed EXPLICITLY rather than left to the preset's auto-detection.
 * react-native-reanimated is not a direct dependency here — it arrives transitively through
 * expo-router — and in an npm workspace it lands in a nested `node_modules` the preset's detection
 * is not guaranteed to look in. Reanimated without its babel transform fails at startup, natively,
 * with nothing useful on screen.
 *
 * It must stay LAST in the plugin list; the transform rewrites worklet functions and expects to
 * run after everything else.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};

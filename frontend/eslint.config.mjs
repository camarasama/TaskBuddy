// ESLint 9 flat config (2026-10-27): Next 16's core-web-vitals preset, replacing .eslintrc.json.
import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

const config = [
  { ignores: ['node_modules/', '.next/', 'public/', 'next-env.d.ts', 'jest.config.js', 'eslint.config.mjs'] },
  ...nextVitals,
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
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: { globals: { ...globals.jest } },
  },
];

export default config;

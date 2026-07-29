import type { Config } from 'tailwindcss';

/**
 * Tokens are imported from shared's TypeScript **source**, by relative path, rather than through
 * the `@taskbuddy/shared` package entry the rest of the frontend uses.
 *
 * That entry resolves to `shared/dist`, which is gitignored and only produced as a side effect of
 * `backend`'s `tsc -b` (via its project reference). This config, however, is loaded by Tailwind at
 * the very start of `next dev` / `next build` — including on a fresh clone where nothing has been
 * built yet. Going through the package entry would make the dev server's first run depend on a
 * build step nothing here declares. Tailwind's config loader transpiles TypeScript, and the tokens
 * module imports nothing, so reading the source directly is both safe and one less ordering trap.
 */
import {
  fontSize,
  glow,
  palette,
  radius,
  rem,
  remScale,
  spacing,
} from '../shared/src/design/tokens';

/**
 * Tailwind wants `{ base: ['1rem', { lineHeight: '1.5rem' }] }`; the tokens keep both numbers on
 * one object. Converted here rather than stored in two shapes.
 */
const fontSizeScale: Record<string, [string, { lineHeight: string }]> = Object.fromEntries(
  Object.entries(fontSize).map(([key, step]) => [
    key,
    [rem(step.fontSize), { lineHeight: rem(step.lineHeight) }],
  ])
);

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // primary / success / warning / gold / xp / slate / destructive, straight from the tokens.
      // `slate` shadows Tailwind's built-in with identical values, deliberately: the app has no
      // built-in palette, so this keeps one definition of the neutrals for both clients.
      colors: palette,
      fontFamily: {
        // The logical names in the tokens (`Inter`, `Poppins`) resolve through next/font's CSS
        // variables here, and through expo-font in the app.
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-poppins)', 'system-ui', 'sans-serif'],
      },
      spacing: remScale(spacing),
      fontSize: fontSizeScale,
      borderRadius: {
        ...remScale(radius),
        // `DEFAULT` is the key behind a bare `rounded`; the tokens call that step `base`. Aliased
        // so the plain class is token-driven too rather than silently keeping Tailwind's own.
        DEFAULT: rem(radius.base),
        // `full` is a sentinel, not a length — see the note on it in the tokens. Unit-converting it
        // gives `624.9375rem`, so it is pinned to px here.
        full: `${radius.full}px`,
      },
      boxShadow: {
        'glow': `0 0 20px ${glow.primary}`,
        'glow-success': `0 0 20px ${glow.success}`,
        'glow-gold': `0 0 20px ${glow.gold}`,
        'glow-xp': `0 0 20px ${glow.xp}`,
      },
      animation: {
        'bounce-slow': 'bounce 2s infinite',
        'pulse-slow': 'pulse 3s infinite',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'celebrate': 'celebrate 0.6s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        celebrate: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

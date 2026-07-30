/**
 * Font loading state, shared by every `AppText`.
 *
 * A context rather than each `AppText` calling `useFonts()` itself: `useFonts` starts a load per call
 * site, and a screen renders dozens of text nodes. One load, one boolean, read by all of them.
 *
 * The app is **not** blocked on this. Text renders in the system font for the fraction of a second the
 * faces take to load and then swaps — a brief reflow, against a blank screen if it were gated. On a cold
 * start the root layout is already showing a spinner for session bootstrap, so in practice the swap
 * happens behind that.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useFonts } from 'expo-font';

import { reportError } from '@/lib/reporting';
import { FONT_ASSETS } from './fonts';

const FontsReadyContext = createContext(false);

/** True once the brand faces are registered and safe to name in a style. */
export function useFontsReady(): boolean {
  return useContext(FontsReadyContext);
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts(FONT_ASSETS);

  /**
   * A font that will not load is a cosmetic failure, never a fatal one — the app stays entirely usable in
   * the system face. It is reported rather than swallowed because the symptom otherwise is "the app looks
   * slightly wrong on one device" and nobody can say why.
   */
  if (error) reportError(error, 'fonts');

  return (
    <FontsReadyContext.Provider value={loaded && !error}>{children}</FontsReadyContext.Provider>
  );
}

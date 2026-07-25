'use client';

/**
 * hooks/useAppBadge — mirrors the pending-approval count onto the installed app icon.
 *
 * Growth roadmap §3.4: approval latency is the loop's heartbeat, and a badge is the cheapest
 * possible reminder — it costs the parent no attention until they look at their home screen.
 *
 * Support is genuinely patchy and that is fine. The Badging API needs an INSTALLED PWA; on iOS it
 * additionally needs the app to have been added to the home screen (roadmap §2.3), and Firefox has
 * no implementation at all. So every call is capability-checked and every failure is swallowed:
 * a browser that cannot do this must behave exactly as it did before, never throw, and never log
 * noise on every render.
 */

import { useEffect } from 'react';

/**
 * True when this browser can show an app-icon badge.
 *
 * lib.dom declares setAppBadge as always present, but that is a compile-time fiction — Firefox and
 * non-installed contexts have no implementation. The runtime typeof check is the real test.
 */
export function supportsAppBadge(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.setAppBadge === 'function';
}

/**
 * Set (or clear) the badge.
 *
 * A count of 0 clears rather than showing a zero — a "0" badge reads as a bug, and the Badging spec
 * treats 0 as "clear" anyway; being explicit avoids relying on that.
 */
export async function setAppBadge(count: number): Promise<void> {
  if (!supportsAppBadge()) return;
  try {
    if (count > 0) {
      await navigator.setAppBadge(count);
    } else {
      await navigator.clearAppBadge?.();
    }
  } catch {
    // Permission denied, or an OS that silently refuses. Not worth surfacing to a parent.
  }
}

/**
 * Keep the app-icon badge in step with `pendingCount`.
 *
 * Deliberately does NOT clear on unmount: the badge should persist while the app is closed — that
 * is the entire point of it. It is cleared by the count reaching zero, not by navigation.
 */
export function useAppBadge(pendingCount: number | undefined): void {
  useEffect(() => {
    if (pendingCount === undefined) return;
    void setAppBadge(pendingCount);
  }, [pendingCount]);
}

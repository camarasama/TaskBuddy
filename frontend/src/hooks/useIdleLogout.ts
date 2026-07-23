'use client';

import { useEffect, useRef } from 'react';
import { CHILD_IDLE_MS, shouldLockAfterHidden } from '@/lib/childSession';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

/**
 * Calls `onIdle` after `idleMs` of no interaction, or when the tab is re-shown after being hidden
 * for at least `idleMs`. Any pointer/key/touch/scroll activity resets the timer. Disabled when
 * `enabled` is false (e.g. non-child users), so it is safe to mount unconditionally.
 */
export function useIdleLogout(
  onIdle: () => void,
  enabled: boolean,
  idleMs: number = CHILD_IDLE_MS,
): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let timer: ReturnType<typeof setTimeout>;
    let hiddenAt: number | null = null;

    const trigger = () => onIdleRef.current();

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(trigger, idleMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        clearTimeout(timer); // pause the idle timer while backgrounded
        return;
      }
      if (shouldLockAfterHidden(hiddenAt, Date.now(), idleMs)) {
        trigger();
        return;
      }
      hiddenAt = null;
      reset();
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    reset();

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, idleMs]);
}

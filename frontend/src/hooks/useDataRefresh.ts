'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `callback` whenever a mutation fires the global 'app:refresh' event.
 * Uses a stable ref so the event listener registers once regardless of
 * whether callback is wrapped in useCallback or not.
 *
 * Usage:
 *   useDataRefresh(loadData);
 */
export function useDataRefresh(callback: () => void): void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, []); // registers once, always calls latest callback via ref
}

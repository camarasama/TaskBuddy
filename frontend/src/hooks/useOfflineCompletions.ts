'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FLUSH_MESSAGE,
  flushOfflineQueue,
  getQueuedCompletions,
  onOfflineQueueChange,
  queueCompletion,
  type FlushResult,
  type QueuedCompletion,
} from '@/lib/offlineQueue';

/**
 * FR-13 — React glue for the offline completion queue.
 *
 * Owns three things the page shouldn't have to: the live online/offline flag, the set of
 * assignment ids currently waiting to sync (for the "Queued" badge), and the replay triggers
 * (page load, the `online` event, and a service-worker ping).
 */
export function useOfflineCompletions(options: {
  /** Replays one queued completion. Must reject with an `ApiError`-shaped error on HTTP failure. */
  send: (entry: QueuedCompletion) => Promise<unknown>;
  /** Called after a pass that changed anything, so the page can refresh and toast. */
  onFlushed?: (result: FlushResult) => void;
}) {
  const { send, onFlushed } = options;

  // navigator.onLine is unavailable during SSR; assume online so the UI never flashes an offline
  // banner on first paint.
  const [isOnline, setIsOnline] = useState(true);
  const [queued, setQueued] = useState<QueuedCompletion[]>([]);

  const sendRef = useRef(send);
  const onFlushedRef = useRef(onFlushed);
  useEffect(() => {
    sendRef.current = send;
    onFlushedRef.current = onFlushed;
  }, [send, onFlushed]);

  const flush = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const result = await flushOfflineQueue((entry) => sendRef.current(entry));
    if (result.synced.length || result.dropped.length) {
      onFlushedRef.current?.(result);
    }
  }, []);

  // Initial state + subscriptions. Registered once.
  useEffect(() => {
    setIsOnline(navigator.onLine);
    void getQueuedCompletions().then(setQueued);
    const unsubscribe = onOfflineQueueChange(setQueued);

    const goOnline = () => {
      setIsOnline(true);
      void flush();
    };
    const goOffline = () => setIsOnline(false);
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === FLUSH_MESSAGE) void flush();
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    // A completion may have been queued in a previous session that ended while offline.
    void flush();

    return () => {
      unsubscribe();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [flush]);

  const queuedIds = new Set(queued.map((q) => q.assignmentId));

  return {
    isOnline,
    queued,
    queuedIds,
    isQueued: (assignmentId: string) => queuedIds.has(assignmentId),
    queueCompletion,
    flush,
  };
}

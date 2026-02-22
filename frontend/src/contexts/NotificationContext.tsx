'use client';

/**
 * contexts/NotificationContext.tsx
 *
 * Single source of truth for notification state. Replaces the per-instance
 * fetch/poll logic that was inside NotificationBell, which caused:
 *   - 2× HTTP requests on mount (bell renders in both desktop sidebar and mobile header)
 *   - 2× polling intervals running simultaneously
 *   - Blocking initial fetch delaying layout paint
 *
 * Strategy:
 *   1. Fetch once on mount, 2 s after layout settles (non-blocking)
 *   2. Real-time updates via socket 'notification:new' (primary channel)
 *   3. Polling fallback at 60 s ONLY when socket is disconnected
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { notificationsApi, type NotificationItem } from '@/lib/api';
import { useSocket } from '@/contexts/SocketContext';

// ─── Context shape ────────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  addOptimistic: (item: NotificationItem) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { socket, isConnected } = useSocket();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const fetchedOnce = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Core fetch ──────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const res = await notificationsApi.getAll({ limit: 20 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
      fetchedOnce.current = true;
    } catch {
      // Non-fatal — degrade silently
    }
  }, []);

  // ── Initial fetch: 1.5 s delay so it never blocks layout paint ─────────────

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(async () => {
      await refresh();
      setLoading(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [refresh]);

  // ── Socket: real-time push (primary channel) ────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleNew = (payload: {
      notificationType: string;
      title: string;
      message: string;
      referenceType?: string;
      referenceId?: string;
      actionUrl?: string;
    }) => {
      const item: NotificationItem = {
        id: `socket-${Date.now()}`,
        notificationType: payload.notificationType,
        title: payload.title,
        message: payload.message,
        actionUrl: payload.actionUrl ?? null,
        referenceType: payload.referenceType ?? null,
        referenceId: payload.referenceId ?? null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      setNotifications((prev) => [item, ...prev].slice(0, 20));
      setUnreadCount((n) => n + 1);
    };

    socket.on('notification:new', handleNew);
    return () => { socket.off('notification:new', handleNew); };
  }, [socket]);

  // ── Polling fallback: only active when socket is disconnected ───────────────

  useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    if (!isConnected) {
      // Socket is down — poll every 60 s as fallback
      pollTimer.current = setInterval(refresh, 60_000);
    }

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [isConnected, refresh]);

  // ── Mutation helpers ────────────────────────────────────────────────────────

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    if (!id.startsWith('socket-')) {
      notificationsApi.markRead(id).catch(() => {});
    }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    notificationsApi.markAllRead().catch(() => {});
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
      return prev.filter((n) => n.id !== id);
    });
    if (!id.startsWith('socket-')) {
      notificationsApi.delete(id).catch(() => {});
    }
  }, []);

  const addOptimistic = useCallback((item: NotificationItem) => {
    setNotifications((prev) => [item, ...prev].slice(0, 20));
    setUnreadCount((n) => n + 1);
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      refresh,
      markRead,
      markAllRead,
      dismiss,
      addOptimistic,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}

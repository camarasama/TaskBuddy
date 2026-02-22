'use client';

/**
 * components/NotificationBell.tsx — updated M10
 *
 * Pure UI component — all data fetching/polling/socket handling is in
 * NotificationContext. This component just reads from context and renders.
 *
 * Previously this component fetched on every mount, which caused double HTTP
 * requests because the bell renders in both the desktop sidebar (hidden lg:flex)
 * and the mobile header (lg:hidden). Both mount regardless of CSS visibility,
 * so both were polling simultaneously. Moving state to context fixes this.
 */

import { useRef, useState, useEffect, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/contexts/NotificationContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

const TYPE_ICON: Record<string, string> = {
  task_assigned:    '📋',
  task_submitted:   '📤',
  task_approved:    '🎉',
  task_rejected:    '❌',
  level_up:         '⬆️',
  achievement:      '🏆',
  reward_redeemed:  '🎁',
  reward_fulfilled: '✅',
  streak_at_risk:   '⚠️',
  streak_milestone: '🔥',
  overlap_warning:  '⚡',
  default:          '🔔',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, loading, markRead, markAllRead, dismiss } = useNotifications();

  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef   = useRef<HTMLButtonElement>(null);

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Open / position ───────────────────────────────────────────────────────

  const handleOpen = () => {
    const opening = !open;
    setOpen(opening);

    if (opening && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 384;
      const top = rect.bottom + 8;
      let right = window.innerWidth - rect.right;
      right = Math.max(8, Math.min(right, window.innerWidth - dropdownWidth - 8));
      setDropdownStyle({ position: 'fixed', top, right, zIndex: 200 });
    }
  };

  // ── Item actions ──────────────────────────────────────────────────────────

  const handleClick = (n: { id: string; isRead: boolean; actionUrl: string | null }) => {
    setOpen(false);
    if (!n.isRead) markRead(n.id);
    if (n.actionUrl) router.push(n.actionUrl);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative p-2 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-live="polite"
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="w-80 sm:w-96 max-h-[520px] flex flex-col rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden"
          style={dropdownStyle}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5">
                  {unreadCount} new
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-3xl mb-2">🔔</div>
                <p className="text-sm text-gray-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${!n.isRead ? 'bg-indigo-50/40' : ''}`}
                >
                  <span className="text-xl shrink-0 mt-0.5" aria-hidden>
                    {TYPE_ICON[n.notificationType] ?? TYPE_ICON.default}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                      aria-label="Dismiss"
                      className="text-gray-300 hover:text-gray-500 transition-colors text-xs leading-none"
                    >✕</button>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 text-center">
              <button
                onClick={() => { setOpen(false); router.push('/notifications'); }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                View all notifications →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
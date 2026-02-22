'use client';

/**
 * /notifications — M10 Phase 4/5
 *
 * Full-page notification inbox for both parent and child roles.
 * Shows all notifications with filter tabs, bulk actions, and pagination.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { notificationsApi, type NotificationItem } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString();
}

const TYPE_ICON: Record<string, string> = {
  task_submitted:   '📋',
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

const TYPE_LABEL: Record<string, string> = {
  task_submitted:   'Task Submitted',
  task_approved:    'Task Approved',
  task_rejected:    'Task Returned',
  level_up:         'Level Up',
  achievement:      'Achievement',
  reward_redeemed:  'Reward',
  reward_fulfilled: 'Reward Fulfilled',
  streak_at_risk:   'Streak Warning',
  streak_milestone: 'Streak Milestone',
  overlap_warning:  'Schedule Warning',
};

const BG_COLORS: Record<string, string> = {
  task_approved:    'bg-green-50 border-green-100',
  task_rejected:    'bg-red-50 border-red-100',
  level_up:         'bg-amber-50 border-amber-100',
  achievement:      'bg-purple-50 border-purple-100',
  streak_at_risk:   'bg-orange-50 border-orange-100',
  overlap_warning:  'bg-yellow-50 border-yellow-100',
  default:          'bg-white border-gray-100',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'unread' | 'tasks' | 'rewards' | 'achievements';

const FILTER_TABS: { id: FilterTab; label: string; icon: string }[] = [
  { id: 'all',          label: 'All',          icon: '🔔' },
  { id: 'unread',       label: 'Unread',        icon: '🔵' },
  { id: 'tasks',        label: 'Tasks',         icon: '📋' },
  { id: 'rewards',      label: 'Rewards',       icon: '🎁' },
  { id: 'achievements', label: 'Achievements',  icon: '🏆' },
];

const TASK_TYPES = new Set(['task_submitted', 'task_approved', 'task_rejected', 'overlap_warning']);
const REWARD_TYPES = new Set(['reward_redeemed', 'reward_fulfilled']);
const ACHIEVEMENT_TYPES = new Set(['achievement', 'level_up', 'streak_milestone', 'streak_at_risk']);

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.getAll({ limit: 100 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter
  const filtered = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.isRead;
    if (activeTab === 'tasks') return TASK_TYPES.has(n.notificationType);
    if (activeTab === 'rewards') return REWARD_TYPES.has(n.notificationType);
    if (activeTab === 'achievements') return ACHIEVEMENT_TYPES.has(n.notificationType);
    return true;
  });

  const handleClick = async (n: NotificationItem) => {
    if (!n.isRead) {
      setNotifications((prev) => prev.map((item) => item.id === n.id ? { ...item, isRead: true } : item));
      setUnreadCount((c) => Math.max(0, c - 1));
      notificationsApi.markRead(n.id).catch(() => {});
    }
    if (n.actionUrl) router.push(n.actionUrl);
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const target = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
    notificationsApi.delete(id).catch(() => {});
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-indigo-600 font-medium mt-0.5">{unreadCount} unread</p>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 md:px-6 pt-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {FILTER_TABS.map((tab) => {
            const count = tab.id === 'unread' ? unreadCount : undefined;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {count !== undefined && count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 ${
                    activeTab === tab.id ? 'bg-white text-indigo-600' : 'bg-red-500 text-white'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Notification list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-2/3" />
                    <div className="h-2.5 bg-gray-100 rounded w-full" />
                    <div className="h-2 bg-gray-100 rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
            <div className="text-4xl mb-3">
              {activeTab === 'unread' ? '✨' : '🔔'}
            </div>
            <p className="text-gray-500 font-medium">
              {activeTab === 'unread' ? 'All caught up!' : 'No notifications here yet'}
            </p>
            {activeTab === 'unread' && (
              <p className="text-sm text-gray-400 mt-1">You've read everything.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => {
              const bgClass = BG_COLORS[n.notificationType] ?? BG_COLORS.default;
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border text-left transition-all hover:shadow-sm ${bgClass} ${!n.isRead ? 'ring-1 ring-indigo-200' : ''}`}
                >
                  {/* Type icon */}
                  <span className="text-2xl shrink-0 mt-0.5">
                    {TYPE_ICON[n.notificationType] ?? TYPE_ICON.default}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 mt-0.5">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                        {TYPE_LABEL[n.notificationType] ?? n.notificationType}
                      </span>
                      {!n.isRead && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                          New
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDelete(e, n.id)}
                    aria-label="Dismiss"
                    className="shrink-0 mt-0.5 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-200 transition-colors"
                  >
                    ✕
                  </button>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

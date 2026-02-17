import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPoints(points: number | undefined | null): string {
  if (points == null) return '0';
  if (points >= 1000) {
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toString();
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d);
}

export function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName ? firstName.charAt(0).toUpperCase() : '';
  const last = lastName ? lastName.charAt(0).toUpperCase() : '';
  return first || last ? `${first}${last}` : '?';
}

export function getDifficultyColor(difficulty: string): string {
  switch (difficulty) {
    case 'EASY':
      return 'text-success-600 bg-success-100';
    case 'MEDIUM':
      return 'text-warning-600 bg-warning-100';
    case 'HARD':
      return 'text-red-600 bg-red-100';
    default:
      return 'text-slate-600 bg-slate-100';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'COMPLETED':
    case 'APPROVED':
    case 'FULFILLED':
      return 'text-success-600 bg-success-100';
    case 'IN_PROGRESS':
    case 'PENDING_APPROVAL':
    case 'PENDING':
      return 'text-warning-600 bg-warning-100';
    case 'OVERDUE':
    case 'REJECTED':
    case 'CANCELLED':
      return 'text-red-600 bg-red-100';
    default:
      return 'text-slate-600 bg-slate-100';
  }
}

// Calculate XP needed for a level
export function xpForLevel(level: number): number {
  const BASE_XP = 100;
  const GROWTH_FACTOR = 1.5;
  return Math.floor(BASE_XP * Math.pow(GROWTH_FACTOR, level - 1));
}

// Calculate total XP needed to reach a level
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

// Calculate level from total XP
export function levelFromXp(totalXp: number): { level: number; currentXp: number; nextLevelXp: number } {
  let level = 1;
  let xpRemaining = totalXp;

  while (xpRemaining >= xpForLevel(level)) {
    xpRemaining -= xpForLevel(level);
    level++;
  }

  return {
    level,
    currentXp: xpRemaining,
    nextLevelXp: xpForLevel(level),
  };
}

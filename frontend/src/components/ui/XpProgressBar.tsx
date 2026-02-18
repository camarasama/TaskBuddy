'use client';

/**
 * XpProgressBar.tsx — M7: Purple XP level progress bar component (CR-06)
 *
 * Place at: frontend/src/components/ui/XpProgressBar.tsx
 *
 * Displays the child's current level and XP progress toward the next level.
 * This is the PURPLE bar — XP only, never shows Points.
 *
 * Key M7 rule: XP is never spent. The bar fills as XP is earned and
 * resets (visually) each time the child levels up. The level number
 * increases permanently.
 *
 * Props:
 *  level         — current level (integer, e.g. 3)
 *  currentLevelXp — XP earned within the current level (resets each level)
 *  xpToNextLevel  — XP required to reach the next level
 *  totalXpEarned  — lifetime XP (shown as subtitle, never decrements)
 *  size          — 'sm' | 'md' | 'lg' (default: 'md')
 *  showLabel     — whether to show "Level N" label (default: true)
 */

import { cn } from '@/lib/utils';

interface XpProgressBarProps {
  level: number;
  currentLevelXp: number;
  xpToNextLevel: number;
  totalXpEarned?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function XpProgressBar({
  level,
  currentLevelXp,
  xpToNextLevel,
  totalXpEarned,
  size = 'md',
  showLabel = true,
  className,
}: XpProgressBarProps) {
  // Clamp progress between 0 and 100%
  const progressPercent = Math.min(
    100,
    Math.max(0, xpToNextLevel > 0 ? (currentLevelXp / xpToNextLevel) * 100 : 0)
  );

  const barHeights = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-3.5',
  };

  const labelSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Label row */}
      {showLabel && (
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            {/* Purple star icon for XP */}
            <span className="text-xp-500 text-sm">⭐</span>
            <span className={cn('font-bold text-xp-700', labelSizes[size])}>
              Level {level}
            </span>
          </div>
          <span className={cn('text-slate-500', labelSizes[size])}>
            {currentLevelXp.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
          </span>
        </div>
      )}

      {/* Progress track */}
      <div
        className={cn(
          'w-full rounded-full bg-xp-100 overflow-hidden',
          barHeights[size]
        )}
        role="progressbar"
        aria-valuenow={currentLevelXp}
        aria-valuemin={0}
        aria-valuemax={xpToNextLevel}
        aria-label={`XP progress: ${currentLevelXp} of ${xpToNextLevel}`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-xp-400 to-xp-600 transition-all duration-700 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Lifetime XP subtitle (optional) */}
      {totalXpEarned !== undefined && size !== 'sm' && (
        <p className="text-xs text-slate-400 mt-1">
          {totalXpEarned.toLocaleString()} total XP earned
        </p>
      )}
    </div>
  );
}

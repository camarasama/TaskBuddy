// frontend/src/components/tasks/ChildCapacityBadge.tsx
// CR-10: Displays a child's current task capacity in the parent's create/edit task form.
// Shows "2/3 tasks | 1 primary" and visually disables the child selector when at limit.

'use client';

import { cn } from '@/lib/utils';

export interface ChildCapacity {
  totalActive: number;
  primaryActive: number;
  maxTotal: number;   // always 3
  maxPrimary: number; // always 1
}

interface ChildCapacityBadgeProps {
  capacity: ChildCapacity;
  taskTag: 'primary' | 'secondary';
  className?: string;
}

/**
 * Returns true if this child cannot accept another task of the given tag.
 */
export function isChildAtLimit(
  capacity: ChildCapacity,
  taskTag: 'primary' | 'secondary'
): boolean {
  if (capacity.totalActive >= capacity.maxTotal) return true;
  if (taskTag === 'primary' && capacity.primaryActive >= capacity.maxPrimary) return true;
  return false;
}

export function ChildCapacityBadge({
  capacity,
  taskTag,
  className,
}: ChildCapacityBadgeProps) {
  const atTotalLimit = capacity.totalActive >= capacity.maxTotal;
  const atPrimaryLimit =
    taskTag === 'primary' && capacity.primaryActive >= capacity.maxPrimary;
  const isBlocked = atTotalLimit || atPrimaryLimit;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1',
        isBlocked
          ? 'bg-red-100 text-red-700'
          : capacity.totalActive >= 2
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-600',
        className
      )}
      title={
        isBlocked
          ? atTotalLimit
            ? 'Task limit reached (3/3)'
            : 'Primary task limit reached (1/1 primary)'
          : `${capacity.totalActive}/${capacity.maxTotal} tasks active`
      }
    >
      {/* Task count dot */}
      <span
        className={cn(
          'flex gap-0.5 items-center',
        )}
      >
        {Array.from({ length: capacity.maxTotal }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'w-2 h-2 rounded-full',
              i < capacity.totalActive
                ? isBlocked
                  ? 'bg-red-500'
                  : 'bg-amber-500'
                : 'bg-current opacity-25'
            )}
          />
        ))}
      </span>

      {/* Text label */}
      <span>
        {capacity.totalActive}/{capacity.maxTotal} tasks
      </span>

      {/* Primary indicator */}
      {capacity.primaryActive > 0 && (
        <>
          <span className="opacity-40">|</span>
          <span>{capacity.primaryActive} primary</span>
        </>
      )}

      {/* Blocked label */}
      {isBlocked && (
        <>
          <span className="opacity-40">·</span>
          <span>full</span>
        </>
      )}
    </div>
  );
}

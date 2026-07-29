/**
 * Date helpers for API payloads.
 *
 * ## The trap these exist for
 *
 * Shared's models type date fields as `Date` — `Task.dueDate?: Date | null`, and a dozen others. Over
 * JSON they are **ISO strings**. TypeScript believes the annotation, so `task.dueDate.getTime()`
 * compiles cleanly and throws at runtime, and `dueDate < new Date()` compiles and silently compares a
 * string to a Date (always false). Neither mistake is visible in review.
 *
 * So nothing should read a date field directly. Everything goes through `asDate` below, which accepts
 * whichever of the two it actually receives.
 */

/** Normalise an API date field — `Date`, ISO string, null or undefined — to a Date or null. */
export function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  // An unparseable string yields an Invalid Date, whose getTime() is NaN. Treat it as absent rather
  // than letting "NaN days ago" reach a screen.
  return Number.isNaN(date.getTime()) ? null : date;
}

const MS_PER_DAY = 86_400_000;

/** Midnight local time, for comparing calendar days rather than instants. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A short human due-date label: "Today", "Tomorrow", "3 days overdue", "Fri 8 Aug".
 *
 * Compares *calendar days*, not elapsed hours. A task due at 09:00 today is "Today" at 17:00, not
 * "1 day overdue" — the latter is technically defensible and reads as a bug to a parent.
 */
export function dueLabel(value: Date | string | null | undefined, now = new Date()): string | null {
  const due = asDate(value);
  if (!due) return null;

  const days = Math.round((startOfDay(due) - startOfDay(now)) / MS_PER_DAY);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days < 7) return `In ${days} days`;

  return due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** True when the date is before today. Used to colour overdue items. */
export function isOverdue(value: Date | string | null | undefined, now = new Date()): boolean {
  const due = asDate(value);
  if (!due) return false;
  return startOfDay(due) < startOfDay(now);
}

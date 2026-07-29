/**
 * Date helpers.
 *
 * These exist because shared's models annotate date fields as `Date` while JSON delivers ISO strings.
 * TypeScript believes the annotation, so `task.dueDate.getTime()` compiles and throws, and
 * `dueDate < new Date()` compiles and silently compares a string to a Date. Both mistakes are
 * invisible in review, which is why the string path is tested explicitly here rather than assumed.
 */
import { asDate, dueLabel, isOverdue } from '../dates';

describe('asDate', () => {
  it('accepts the ISO string the API actually sends', () => {
    const result = asDate('2026-07-29T10:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-07-29T10:00:00.000Z');
  });

  it('passes a real Date through', () => {
    const now = new Date('2026-07-29T10:00:00.000Z');
    expect(asDate(now)?.getTime()).toBe(now.getTime());
  });

  it('treats null and undefined as absent', () => {
    expect(asDate(null)).toBeNull();
    expect(asDate(undefined)).toBeNull();
  });

  it('treats an unparseable string as absent rather than an Invalid Date', () => {
    // Otherwise "NaN days overdue" reaches a screen.
    expect(asDate('not a date')).toBeNull();
    expect(asDate('')).toBeNull();
  });
});

describe('dueLabel', () => {
  // Late afternoon, so the "same calendar day but hours past" case is actually exercised.
  const now = new Date(2026, 6, 29, 17, 0, 0);

  it('says Today for a time earlier the same day', () => {
    /**
     * The case that matters. A task due at 09:00 is still "Today" at 17:00 — an elapsed-hours
     * calculation would call it "1 day overdue", which is technically defensible and reads as a bug to
     * a parent looking at their own morning task.
     */
    expect(dueLabel(new Date(2026, 6, 29, 9, 0, 0).toISOString(), now)).toBe('Today');
  });

  it('handles the near days by name', () => {
    expect(dueLabel(new Date(2026, 6, 30, 8, 0).toISOString(), now)).toBe('Tomorrow');
    expect(dueLabel(new Date(2026, 6, 28, 23, 0).toISOString(), now)).toBe('Yesterday');
  });

  it('counts overdue days', () => {
    expect(dueLabel(new Date(2026, 6, 26, 12, 0).toISOString(), now)).toBe('3 days overdue');
  });

  it('counts forward within the week', () => {
    expect(dueLabel(new Date(2026, 7, 1, 12, 0).toISOString(), now)).toBe('In 3 days');
  });

  it('falls back to a date for anything further out', () => {
    const label = dueLabel(new Date(2026, 7, 20, 12, 0).toISOString(), now);
    // Locale-dependent formatting, so assert it is a date-ish string rather than an exact one.
    expect(label).toMatch(/20/);
    expect(label).not.toMatch(/days/);
  });

  it('returns null when there is no due date', () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel(undefined, now)).toBeNull();
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 6, 29, 17, 0, 0);

  it('is false for earlier the same day', () => {
    expect(isOverdue(new Date(2026, 6, 29, 9, 0).toISOString(), now)).toBe(false);
  });

  it('is true for a previous day', () => {
    expect(isOverdue(new Date(2026, 6, 28, 23, 59).toISOString(), now)).toBe(true);
  });

  it('is false without a due date', () => {
    expect(isOverdue(null, now)).toBe(false);
  });
});

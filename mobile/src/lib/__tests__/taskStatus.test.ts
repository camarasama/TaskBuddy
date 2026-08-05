/**
 * The done/outstanding rule, pinned.
 *
 * These read as trivial and are not: the dashboard's progress bar and the tasks screen's strikethrough
 * both depend on this agreeing with itself, and the two judgement calls below (`completed` is done,
 * `rejected` is not) are exactly the kind of thing a later edit "tidies up" without realising a child
 * who finished everything would then see a 0% bar.
 */
import { completionPercent, isDone, isOutstanding } from '../taskStatus';

describe('isDone', () => {
  it('counts a completed task, before any parent has approved it', () => {
    // The child's work is finished; approval is somebody else's turn. Treating this as not-done shows
    // a child who did everything a bar reading zero.
    expect(isDone('completed')).toBe(true);
  });

  it('counts an approved task', () => {
    expect(isDone('approved')).toBe(true);
  });

  it.each(['pending', 'in_progress'] as const)('does not count %s', (status) => {
    expect(isDone(status)).toBe(false);
  });

  it('does not count a rejected task — it is back in the child’s court', () => {
    expect(isDone('rejected')).toBe(false);
    expect(isOutstanding('rejected')).toBe(true);
  });
});

describe('completionPercent', () => {
  it('returns 0 for an empty list rather than NaN', () => {
    // 0/0 is NaN, which reaches a style as `width: "NaN%"` — an unpredictable bar plus a layout
    // warning. "No tasks today" is legitimately 0% complete.
    expect(completionPercent(0, 0)).toBe(0);
    expect(Number.isNaN(completionPercent(0, 0))).toBe(false);
  });

  it('scales between the endpoints', () => {
    expect(completionPercent(0, 4)).toBe(0);
    expect(completionPercent(1, 4)).toBe(25);
    expect(completionPercent(4, 4)).toBe(100);
  });

  it('clamps rather than overflowing the bar', () => {
    expect(completionPercent(5, 4)).toBe(100);
    expect(completionPercent(-1, 4)).toBe(0);
  });
});

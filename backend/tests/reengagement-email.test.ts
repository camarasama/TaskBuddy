/**
 * Re-engagement email templates: every step renders, escaping holds, the unsubscribe link is in the
 * footer, and the lapsed summary never prints a zero.
 */

import { renderTemplate } from '../src/emails/base';
import { reengagementContent, type ReengagementData } from '../src/emails/reengagement';

function data(over: Partial<ReengagementData> = {}): ReengagementData {
  return {
    track: 'setup',
    step: 1,
    firstName: 'Amina',
    familyName: 'Diallo',
    appUrl: 'https://app.example.com',
    unsubscribeUrl: 'https://app.example.com/unsubscribe?u=1&t=abc',
    ...over,
  };
}

describe('reengagement templates', () => {
  it.each([
    ['setup', 1], ['setup', 2], ['setup', 3], ['setup', 4],
    ['lapsed', 1], ['lapsed', 2], ['lapsed', 3], ['lapsed', 4],
  ] as const)('%s step %i renders with greeting, button and unsubscribe link', async (track, step) => {
    const html = await renderTemplate('reengagement', data({ track, step }));
    expect(html).toContain('Hi Amina,');
    expect(html).toContain('Stop tips and reminders');
    expect(html).toContain('/unsubscribe?u=1&amp;t=abc');
    expect(html).toContain('https://app.example.com/parent/');
    // House style: no em dashes in anything we send.
    expect(html).not.toContain('\u2014');
  });

  it('step 4 is the same goodbye on both tracks', () => {
    expect(reengagementContent(data({ track: 'setup', step: 4 })).subject).toBe(
      reengagementContent(data({ track: 'lapsed', step: 4 })).subject,
    );
  });

  it('escapes a hostile family name', async () => {
    const html = await renderTemplate('reengagement', data({ familyName: '<a href="https://evil">x</a>' }));
    expect(html).not.toContain('<a href="https://evil">');
    expect(html).toContain('&lt;a href=');
  });

  it('lapsed step 1 lists only the achievements that exist', () => {
    const c = reengagementContent(
      data({ track: 'lapsed', step: 1, stats: { tasksDone: 23, rewardsEarned: 0, streakChildName: 'Sami', streakDays: 6 } }),
    );
    expect(c.paragraphs[0]).toBe('Here is what the Diallo family achieved on TaskBuddy so far: 23 tasks completed and a best streak of 6 days for Sami.');
    expect(c.paragraphs[0]).not.toContain('0 rewards');
  });

  it('lapsed step 1 falls back to a generic line with nothing to report', () => {
    const c = reengagementContent(data({ track: 'lapsed', step: 1, stats: { tasksDone: 0, rewardsEarned: 0 } }));
    expect(c.paragraphs[0]).toContain('great start');
  });
});

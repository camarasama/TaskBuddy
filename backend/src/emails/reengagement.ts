/**
 * emails/reengagement.ts - the two "come back" tracks (admin insights, 2026-10-26).
 * triggerType: 'reengagement'
 *
 * Copy approved with the dashboard design. Parents only. Every email carries a one-click way to
 * stop them (footer link + List-Unsubscribe header, see ReengagementService).
 *
 * All strings arrive HTML-escaped (renderTemplate escapes template data), URLs included.
 */

import { baseLayout, ctaButton } from './base';

export type ReengagementTrack = 'setup' | 'lapsed';

export interface ReengagementData {
  track: ReengagementTrack;
  step: number;
  firstName: string;
  familyName: string;
  appUrl: string;
  unsubscribeUrl: string;
  /** Only for lapsed step 1. Any missing piece is left out of the sentence, never shown as 0. */
  stats?: {
    tasksDone: number;
    rewardsEarned: number;
    streakChildName?: string | null;
    streakDays?: number | null;
  };
}

interface Content {
  subject: string;
  preheader: string;
  paragraphs: string[];
  ideas?: Array<[string, string]>;
  cta: { label: string; path: string };
  tip: string;
}

const P = 'margin:0 0 16px;color:#334155;font-size:16px;line-height:1.6;';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function lapsedSummary(d: ReengagementData): string {
  const s = d.stats;
  if (!s) return '';
  const parts: string[] = [];
  if (s.tasksDone > 0) parts.push(`${plural(s.tasksDone, 'task', 'tasks')} completed`);
  if (s.rewardsEarned > 0) parts.push(`${plural(s.rewardsEarned, 'reward', 'rewards')} earned`);
  if (s.streakChildName && s.streakDays && s.streakDays > 1) {
    parts.push(`a best streak of ${s.streakDays} days for ${s.streakChildName}`);
  }
  if (parts.length === 0) return '';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Here is what the ${d.familyName} family achieved on TaskBuddy so far: ${list}.`;
}

const FINAL: (d: ReengagementData) => Content = () => ({
  subject: 'Should we keep your family’s space?',
  preheader: 'This is the last reminder we will send.',
  paragraphs: [
    'We will stop these reminders after this one.',
    'Your family’s space is still here, with everything you set up. If now is not the right time, that is fine. When you are ready, one tap takes you back to where you left off.',
  ],
  cta: { label: 'Open TaskBuddy', path: '/parent/dashboard' },
  // Not "reply to this email": the sender is a no-reply address.
  tip: 'Your data stays safe and private while you are away. You are always welcome back.',
});

const CONTENT: Record<ReengagementTrack, Array<(d: ReengagementData) => Content>> = {
  setup: [
    (d) => ({
      subject: 'Your family’s first task takes 2 minutes',
      preheader: 'Here is the quickest way to get started.',
      paragraphs: [
        `You created the ${d.familyName} family on TaskBuddy. Nice start.`,
        'The next step is the one that makes it click: add your child and give them one small task they can finish today, like setting the table for 10 points. When they tick it off, you approve it with one tap and they watch their points grow.',
      ],
      cta: { label: 'Add your first task', path: '/parent/tasks/new' },
      tip: 'Tip: let your child choose the first reward. It makes the points mean something.',
    }),
    () => ({
      subject: '3 tasks families start with',
      preheader: 'Small, daily wins build the habit fastest.',
      paragraphs: ['Not sure what to add first? These three work in almost every home. Pick one, not all three.'],
      ideas: [
        ['Make your bed, every morning', '5 points'],
        ['Homework done before screen time', '10 points'],
        ['Help carry the shopping', '15 points'],
      ],
      cta: { label: 'Pick a starter task', path: '/parent/tasks/new' },
      tip: 'Children can sign in on their own phone with a QR code from your app.',
    }),
    () => ({
      subject: 'Less nagging, more teamwork',
      preheader: 'A 10-minute family plan for the week.',
      paragraphs: [
        'The biggest change families notice is the tone at home. Instead of reminding, you agree the plan together, then everyone can see what is done.',
        'Try a short family check-in this weekend: choose this week’s tasks together, agree on one reward everybody works towards, and let your children tick things off themselves.',
      ],
      cta: { label: 'Plan this week together', path: '/parent/tasks' },
      tip: 'Tip: put the agreed reward somewhere everyone can see it. It keeps the goal in mind all week.',
    }),
    FINAL,
  ],
  lapsed: [
    (d) => ({
      subject: 'Look what your family did together',
      preheader: 'A quick look back, and an easy way to restart.',
      paragraphs: [
        lapsedSummary(d) || `The ${d.familyName} family has made a great start on TaskBuddy.`,
        'A short family check-in on Sunday is often all it takes to restart: choose this week’s tasks together, agree on one reward, and let everyone see the progress.',
      ],
      cta: { label: 'Plan this week together', path: '/parent/dashboard' },
      tip: 'Tip: put the agreed reward somewhere everyone can see it. It keeps the goal in mind all week.',
    }),
    () => ({
      subject: 'New on TaskBuddy: games and team tasks',
      preheader: 'A few things your children have not tried yet.',
      paragraphs: [
        'TaskBuddy has grown since you last visited.',
        'Children can play short learning games for bonus points, brothers and sisters can share a team task and finish it together, and the whole family can save up for one shared reward.',
      ],
      cta: { label: 'See what is new', path: '/parent/dashboard' },
      tip: 'Streak shields protect a streak on a busy day, so one missed evening does not undo a good week.',
    }),
    () => ({
      subject: 'A fresh start for the new week',
      preheader: 'Three small steps to get the family going again.',
      paragraphs: [
        'Getting back into a routine is easier with a clean slate.',
        'Archive the tasks that no longer fit, pick three new ones together, and choose a reward your children are excited about. Ten minutes on Sunday evening is enough.',
      ],
      cta: { label: 'Start the week', path: '/parent/tasks' },
      tip: 'Tip: start with tasks your children already do. Early wins make the next ones easier.',
    }),
    FINAL,
  ],
};

export function reengagementContent(d: ReengagementData): Content {
  const list = CONTENT[d.track];
  const build = list[Math.min(Math.max(d.step, 1), list.length) - 1];
  return build(d);
}

/** Subject without rendering, for EmailService.send. Takes RAW (unescaped) data. */
export function reengagementSubject(d: ReengagementData): string {
  return reengagementContent(d).subject;
}

export function buildReengagement(d: ReengagementData): string {
  const c = reengagementContent(d);
  const ideas = c.ideas?.length
    ? `<table width="100%" cellpadding="10" cellspacing="0" border="0" style="background:#f8fafc;border-radius:8px;margin:0 0 16px;">
        ${c.ideas
          .map(
            ([name, pts]) => `<tr>
          <td style="color:#334155;font-size:15px;">${name}</td>
          <td style="color:#64748b;font-size:14px;text-align:right;white-space:nowrap;">${pts}</td>
        </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const inner = `
  <tr>
    <td style="padding:36px 40px 8px;">
      <p style="${P}">Hi ${d.firstName},</p>
      ${c.paragraphs.map((t) => `<p style="${P}">${t}</p>`).join('')}
      ${ideas}
      ${ctaButton(c.cta.label, `${d.appUrl}${c.cta.path}`)}
      <p style="margin:0 0 8px;color:#64748b;font-size:14px;line-height:1.6;">${c.tip}</p>
    </td>
  </tr>`;

  const footer = `You get this because you created a TaskBuddy family.<br>
    <a href="${d.unsubscribeUrl}" style="color:#6366f1;text-decoration:none;">Stop tips and reminders</a>
    &nbsp;&middot;&nbsp;
    <a href="${d.appUrl}/parent/settings" style="color:#6366f1;text-decoration:none;">Email settings</a>`;

  return baseLayout(inner, c.preheader, footer);
}

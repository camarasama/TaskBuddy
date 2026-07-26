'use client';

/**
 * TeamBadge — the cooperation signal on a team-up task (growth roadmap §6).
 *
 * This is the actual point of the feature. The bonus arithmetic is trivial; what makes a team task
 * feel different from a shared one is a child being able to see who they're working with and who is
 * still outstanding.
 *
 * Deliberately never phrased as blame. "Waiting on Kofi" states a fact a child can act on by going
 * to help; anything sharper turns a cooperation feature into a way to nag a sibling.
 */

import { Users, Check } from 'lucide-react';

export interface TeamMember {
  childId: string;
  firstName: string;
  avatarUrl?: string | null;
  status: string;
}

export interface TeamSummary {
  total: number;
  approved: number;
  complete: boolean;
  bonusPoints: number;
  bonusAwarded: boolean;
  members: TeamMember[];
}

export function TeamBadge({ team, meId }: { team: TeamSummary; meId?: string }) {
  const others = team.members.filter((m) => m.childId !== meId);
  const waiting = others.filter((m) => m.status !== 'approved');

  return (
    <div className="mt-2 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
        <Users className="w-3.5 h-3.5" />
        Team-up
        {team.bonusPoints > 0 && (
          <span className="font-normal text-indigo-600">
            · +{team.bonusPoints} bonus each when everyone&apos;s done
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {team.members.map((member) => (
          <span
            key={member.childId}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              member.status === 'approved'
                ? 'bg-white text-green-700 border border-green-200'
                : 'bg-white text-slate-500 border border-slate-200'
            }`}
          >
            {member.status === 'approved' && <Check className="w-3 h-3" />}
            {member.childId === meId ? 'You' : member.firstName}
          </span>
        ))}
      </div>

      {team.bonusAwarded ? (
        <p className="text-xs text-green-700 mt-1.5 font-medium">
          🤝 Everyone finished — bonus paid!
        </p>
      ) : waiting.length > 0 ? (
        <p className="text-xs text-indigo-600 mt-1.5">
          Waiting on {waiting.map((m) => m.firstName).join(' and ')}.
        </p>
      ) : null}
    </div>
  );
}

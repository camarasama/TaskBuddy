'use client';

/**
 * /admin/games - manage quiz definitions and their question banks.
 *
 * Before this page, game content could only be changed by editing gamesSeed.ts and redeploying, so
 * growing a question bank was a code change. Daily rotation draws from the bank, which makes bank
 * size the thing that decides whether the quiz actually varies - hence the rotation-health column
 * rather than a bare question count.
 */

import { useCallback, useEffect, useState } from 'react';
import { adminGamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import type { AdminGameSummary, RotationHealth } from '@taskbuddy/shared';
import { GameEditor } from '@/components/admin/GameEditor';

const HEALTH_LABEL: Record<RotationHealth, { text: string; className: string; hint: string }> = {
  none: {
    text: 'No rotation',
    className: 'bg-red-100 text-red-700',
    hint: 'The bank is not bigger than one play, so every day serves the same questions.',
  },
  low: {
    text: 'Low variety',
    className: 'bg-amber-100 text-amber-700',
    hint: 'Fewer than 3 plays worth of questions - children will see repeats quickly.',
  },
  good: {
    text: 'Good variety',
    className: 'bg-green-100 text-green-700',
    hint: 'The bank comfortably supports a different draw each day.',
  },
};

export default function AdminGamesPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminGamesApi.list();
      setGames((res.data as { games: AdminGameSummary[] }).games);
    } catch {
      showError('Failed to load games');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (game: AdminGameSummary) => {
    const played = game.totalSessions > 0;
    const confirmed = window.confirm(
      played
        ? `"${game.title}" has been played ${game.totalSessions} time(s). It will be deactivated (hidden from children) and its play history kept. Continue?`
        : `"${game.title}" has never been played and will be permanently deleted. Continue?`,
    );
    if (!confirmed) return;

    try {
      const res = await adminGamesApi.remove(game.id);
      showSuccess((res.data as { message: string }).message);
      void load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to remove game');
    }
  };

  const handleToggleActive = async (game: AdminGameSummary) => {
    try {
      await adminGamesApi.update(game.id, { isActive: !game.isActive });
      showSuccess(game.isActive ? 'Game deactivated' : 'Game activated');
      void load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update game');
    }
  };

  const closeEditor = (changed: boolean) => {
    setEditingId(null);
    setCreating(false);
    if (changed) void load();
  };

  // No AdminLayout wrapper here: app/admin/layout.tsx already wraps every /admin/* page in it.
  // Wrapping again renders a second sidebar alongside the first.
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Mini Games</h2>
          <p className="text-slate-500 text-sm mt-1">
            Each play draws {' '}
            <span className="font-medium text-slate-600">questions per session</span> from the bank,
            rotating daily. A bigger bank means more variety.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-indigo-600 text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 transition-colors"
        >
          + New game
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-5 w-40 bg-slate-100 rounded mb-3" />
              <div className="h-4 w-64 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : games.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
          <p className="text-slate-500 mb-4">No games yet.</p>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-indigo-600 text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700"
          >
            Create the first game
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {games.map((game) => {
            const health = HEALTH_LABEL[game.rotationHealth];
            return (
              <div
                key={game.id}
                className={`bg-white rounded-xl border p-5 ${
                  game.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-slate-800">{game.title}</h3>
                      {!game.isActive && (
                        <span className="text-xs bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">
                          Inactive
                        </span>
                      )}
                      <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                        {game.difficulty}
                      </span>
                      <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                        {game.ageGroup ?? 'all ages'}
                      </span>
                      <span
                        title={health.hint}
                        className={`text-xs rounded-full px-2 py-0.5 font-medium ${health.className}`}
                      >
                        {health.text}
                      </span>
                    </div>

                    {game.description && (
                      <p className="text-sm text-slate-500 mb-2">{game.description}</p>
                    )}

                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                      <div>
                        <dt className="inline font-medium text-slate-600">Bank:</dt>{' '}
                        <dd className="inline">{game.bankSize} questions</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-600">Per play:</dt>{' '}
                        <dd className="inline">{game.questionsPerSession}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-600">Reward:</dt>{' '}
                        <dd className="inline">
                          {game.pointsReward} pts / {game.xpReward} XP
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-600">Cooldown:</dt>{' '}
                        <dd className="inline">{game.cooldownHours}h</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-600">Plays:</dt>{' '}
                        <dd className="inline">
                          {game.completedSessions} completed
                          {game.completedSessions > 0 && `, avg ${game.avgPointsAwarded} pts`}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setEditingId(game.id)}
                      className="rounded-lg border border-slate-200 text-slate-700 text-sm px-3 py-1.5 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(game)}
                      className="rounded-lg border border-slate-200 text-slate-600 text-sm px-3 py-1.5 hover:bg-slate-50"
                    >
                      {game.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(game)}
                      className="rounded-lg border border-red-200 text-red-600 text-sm px-3 py-1.5 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(editingId || creating) && (
        <GameEditor gameId={editingId} onClose={closeEditor} />
      )}
    </>
  );
}

'use client';

/**
 * Games lobby — pick a subject, then a level.
 *
 * Replaces the flat list of three games. Two steps rather than one screen of eighteen cards: eighteen
 * choices is not a choice a child makes, it is a wall they scroll past.
 *
 * The category step is where cooldown lives, because the cooldown itself is category-scoped — finishing
 * any maths game times out every maths level. Showing the timer on the level step instead would imply the
 * levels time out independently, which is the opposite of true.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Gamepad2, Star, Clock, Zap, Lock, Play, History, ChevronLeft } from 'lucide-react';
import {
  GAME_CATEGORIES,
  GAME_CATEGORY_LABELS,
  GAME_LEVELS,
  GAME_LEVEL_LABELS,
  type GameCategory,
  type GameLevel,
} from '@taskbuddy/shared';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { gamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface GameDef {
  id: string;
  type: string;
  title: string;
  description?: string;
  category: GameCategory;
  level: GameLevel;
  difficulty: string;
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  questionCount: number;
  onCooldown: boolean;
  cooldownEndsAt: string | null;
}

/** Emoji rather than icons: six categories need to be distinguishable at a glance by a 10-year-old. */
const CATEGORY_EMOJI: Record<GameCategory, string> = {
  maths: '🔢',
  science: '🔬',
  geography: '🌍',
  vocabulary: '📖',
  grammar: '✏️',
  puzzle: '🧩',
};

const LEVEL_STYLE: Record<GameLevel, string> = {
  beginner: 'bg-success-100 text-success-700 border-success-200',
  intermediate: 'bg-warning-100 text-warning-700 border-warning-200',
  hard: 'bg-xp-100 text-xp-700 border-xp-200',
};

function CooldownTimer({ endsAt }: { endsAt: string }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) { setLabel('Ready'); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [endsAt]);
  return <span>{label}</span>;
}

export default function GamesLobbyPage() {
  const router = useRouter();
  const { error: showError } = useToast();
  const [games, setGames] = useState<GameDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<GameCategory | null>(null);

  useEffect(() => {
    gamesApi.list()
      .then((res) => setGames((res.data as { games: GameDef[] }).games))
      .catch(() => showError('Failed to load games'))
      .finally(() => setLoading(false));
  }, [showError]);

  /**
   * Group by category once. Cooldown is read off any member of the group rather than tracked
   * separately — the server already scopes it per category, so every game in a category agrees.
   */
  const byCategory = useMemo(() => {
    const map = new Map<GameCategory, GameDef[]>();
    for (const g of games) {
      const list = map.get(g.category) ?? [];
      list.push(g);
      map.set(g.category, list);
    }
    return map;
  }, [games]);

  const handlePlay = async (game: GameDef) => {
    if (game.onCooldown) return;
    setStartingId(game.id);
    try {
      // The play screen fetches the session by id, so nothing is cached client-side - a refresh
      // mid-quiz resumes instead of stranding an in_progress session.
      const res = await gamesApi.startSession(game.id);
      const { sessionId } = res.data as { sessionId: string };
      router.push(`/child/games/play?session=${sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start game';
      showError(message);
    } finally {
      setStartingId(null);
    }
  };

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {chosen ? (
          <button
            onClick={() => setChosen(null)}
            aria-label="Back to subjects"
            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-xp-400 to-gold-500 flex items-center justify-center">
            <Gamepad2 className="w-6 h-6 text-white" />
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {chosen ? GAME_CATEGORY_LABELS[chosen] : 'Mini Games'}
          </h1>
          <p className="text-slate-500 text-sm">
            {chosen ? 'Pick how hard you want it' : 'Pick a subject to play'}
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="secondary"
        onClick={() => router.push('/child/games/history')}
        className="shrink-0"
      >
        <History className="w-4 h-4" /> My games
      </Button>
    </div>
  );

  if (loading) {
    return (
      <ChildLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          {header}
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-xp-500 border-t-transparent" />
          </div>
        </div>
      </ChildLayout>
    );
  }

  return (
    <ChildLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {header}

        {/* ── Step 1: subject ─────────────────────────────────────────────── */}
        {!chosen && (
          <div className="grid grid-cols-2 gap-3">
            {GAME_CATEGORIES.map((category) => {
              const inCategory = byCategory.get(category) ?? [];
              // Cooldown is category-wide, so any member reports it.
              const onCooldown = inCategory.length > 0 && inCategory[0].onCooldown;
              const endsAt = inCategory[0]?.cooldownEndsAt ?? null;
              const empty = inCategory.length === 0;

              return (
                <motion.button
                  key={category}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  disabled={empty}
                  onClick={() => setChosen(category)}
                  className={cn(
                    'text-left bg-white rounded-2xl p-4 border shadow-sm transition-all',
                    empty && 'opacity-50 cursor-not-allowed border-slate-200',
                    !empty && onCooldown && 'border-slate-200 opacity-70',
                    !empty && !onCooldown && 'border-gold-200 hover:border-gold-400',
                  )}
                >
                  <div className="text-3xl mb-1.5" aria-hidden>{CATEGORY_EMOJI[category]}</div>
                  <h3 className="font-bold text-slate-900">{GAME_CATEGORY_LABELS[category]}</h3>

                  {empty ? (
                    <p className="text-xs text-slate-400 mt-1">Coming soon</p>
                  ) : onCooldown && endsAt ? (
                    // Said in words as well as the dimmed card, so the state does not depend on
                    // noticing opacity.
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Ready in <CooldownTimer endsAt={endsAt} />
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-1">
                      {inCategory.length} {inCategory.length === 1 ? 'level' : 'levels'} ready
                    </p>
                  )}
                </motion.button>
              );
            })}
          </div>
        )}

        {/* ── Step 2: level ───────────────────────────────────────────────── */}
        {chosen && (
          <div className="space-y-3">
            {GAME_LEVELS.map((level) => {
              const game = (byCategory.get(chosen) ?? []).find((g) => g.level === level);

              if (!game) {
                return (
                  <div
                    key={level}
                    className="bg-white rounded-2xl p-5 border border-slate-200 opacity-60"
                  >
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', LEVEL_STYLE[level])}>
                      {GAME_LEVEL_LABELS[level]}
                    </span>
                    <p className="text-sm text-slate-400 mt-2">Not ready yet — coming soon!</p>
                  </div>
                );
              }

              return (
                <motion.div
                  key={level}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'bg-white rounded-2xl p-5 border shadow-sm transition-all',
                    game.onCooldown ? 'border-slate-200 opacity-70' : 'border-gold-200 hover:border-gold-400',
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', LEVEL_STYLE[level])}>
                          {GAME_LEVEL_LABELS[level]}
                        </span>
                        <span className="text-xs text-slate-400">{game.questionCount} questions</span>
                      </div>
                      <h3 className="font-bold text-slate-900">{game.title}</h3>
                      {game.description && <p className="text-sm text-slate-500 mt-0.5">{game.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Star className="w-3 h-3 text-gold-500" />{game.pointsReward} pts</span>
                        <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-xp-500" />{game.xpReward} XP</span>
                      </div>
                      {game.onCooldown && game.cooldownEndsAt && (
                        <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          {/* Names the subject, so it is clear the whole subject is resting rather
                              than just this level. */}
                          All {GAME_CATEGORY_LABELS[chosen]} ready in <CooldownTimer endsAt={game.cooldownEndsAt} />
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handlePlay(game)}
                      disabled={game.onCooldown || startingId === game.id}
                      className={game.onCooldown ? 'bg-slate-200 text-slate-400' : 'bg-gold-500 hover:bg-gold-600 text-white'}
                    >
                      {startingId === game.id
                        ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        : game.onCooldown
                        ? <Lock className="w-4 h-4" />
                        : <><Play className="w-4 h-4" /> Play</>
                      }
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {!chosen && games.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <Gamepad2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No games available yet</p>
          </div>
        )}
      </div>
    </ChildLayout>
  );
}

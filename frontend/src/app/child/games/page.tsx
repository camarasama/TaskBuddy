'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Gamepad2, Star, Clock, Zap, Lock, Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { gamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getDifficultyColor } from '@/lib/utils';

interface GameDef {
  id: string;
  type: string;
  title: string;
  description?: string;
  difficulty: string;
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  questionCount: number;
  onCooldown: boolean;
  cooldownEndsAt: string | null;
}

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

  useEffect(() => {
    gamesApi.list()
      .then((res) => setGames((res.data as { games: GameDef[] }).games))
      .catch(() => showError('Failed to load games'))
      .finally(() => setLoading(false));
  }, [showError]);

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

  return (
    <ChildLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-xp-400 to-gold-500 flex items-center justify-center">
            <Gamepad2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Mini Games</h1>
            <p className="text-slate-500 text-sm">Answer correctly to earn points!</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-xp-500 border-t-transparent" />
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <Gamepad2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No games available yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {games.map((game) => (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'bg-white rounded-2xl p-5 border shadow-sm transition-all',
                  game.onCooldown ? 'border-slate-200 opacity-70' : 'border-gold-200 hover:border-gold-400'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', getDifficultyColor(game.difficulty.toUpperCase()))}>
                        {game.difficulty}
                      </span>
                      <span className="text-xs text-slate-400">{game.questionCount} questions</span>
                    </div>
                    <h3 className="font-bold text-slate-900">{game.title}</h3>
                    {game.description && <p className="text-sm text-slate-500 mt-0.5">{game.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 text-gold-500" />{game.pointsReward} pts</span>
                      <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-xp-500" />{game.xpReward} XP</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{game.cooldownHours}h cooldown</span>
                    </div>
                    {game.onCooldown && game.cooldownEndsAt && (
                      <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Ready in <CooldownTimer endsAt={game.cooldownEndsAt} />
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
            ))}
          </div>
        )}
      </div>
    </ChildLayout>
  );
}

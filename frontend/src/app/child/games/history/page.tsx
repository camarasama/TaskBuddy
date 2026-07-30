'use client';

/**
 * "My games" — the child's own record of what they played and how it went.
 *
 * One screen with two states rather than two routes: the list, and a selected game's per-question review.
 * Keeping the review inline means going back does not refetch the list, which matters on a phone.
 *
 * The review data has existed since per-question grading shipped — `servedQuestionsJson` + `answersJson` —
 * and `submit` already returned it once. This screen exists because nothing could read it back afterwards.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronLeft, Check, X, Star, Zap, History, Gamepad2 } from 'lucide-react';
import {
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  type GameHistoryEntry,
  type GameReviewResponse,
} from '@taskbuddy/shared';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { gamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

function playedLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.round(
    (new Date(new Date().toDateString()).getTime() - new Date(then.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return `Today, ${then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Score colour reflects the 60% floor — below it a game earns nothing, so it should not look like a pass. */
function scoreTone(correct: number, total: number): string {
  if (total === 0) return 'text-slate-500';
  return correct / total >= 0.6 ? 'text-success-600' : 'text-amber-600';
}

export default function GamesHistoryPage() {
  const router = useRouter();
  const { error: showError } = useToast();
  const [sessions, setSessions] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<GameReviewResponse | null>(null);
  const [loadingReview, setLoadingReview] = useState<string | null>(null);

  useEffect(() => {
    gamesApi.history()
      .then((res) => setSessions((res.data as { sessions: GameHistoryEntry[] }).sessions))
      .catch(() => showError('Could not load your games'))
      .finally(() => setLoading(false));
  }, [showError]);

  const openReview = useCallback(
    async (sessionId: string) => {
      setLoadingReview(sessionId);
      try {
        const res = await gamesApi.review(sessionId);
        setReview(res.data as GameReviewResponse);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not load that game');
      } finally {
        setLoadingReview(null);
      }
    },
    [showError],
  );

  // ── Review of one game ──────────────────────────────────────────────────────
  if (review) {
    return (
      <ChildLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setReview(null)}
              aria-label="Back to my games"
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">{review.game.title}</h1>
              <p className="text-slate-500 text-sm">
                {GAME_CATEGORY_LABELS[review.game.category]} · {GAME_LEVEL_LABELS[review.game.level]} ·{' '}
                {playedLabel(review.playedAt)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">Score</p>
              <p className={cn('text-3xl font-bold', scoreTone(review.correctCount, review.totalQuestions))}>
                {review.correctCount}/{review.totalQuestions}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-gold-600 font-semibold">
                <Star className="w-4 h-4" />{review.pointsAwarded} pts
              </span>
              <span className="flex items-center gap-1 text-xp-600 font-semibold">
                <Zap className="w-4 h-4" />{review.xpAwarded} XP
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {review.review.map((q, i) => (
              <motion.div
                key={q.questionIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={cn(
                  'bg-white rounded-2xl p-4 border',
                  q.correct ? 'border-success-200' : 'border-destructive-200',
                )}
              >
                <div className="flex items-start gap-2">
                  {/* Icon AND colour AND text below — the outcome never depends on colour alone. */}
                  <span
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                      q.correct ? 'bg-success-500' : 'bg-destructive-500',
                    )}
                    aria-hidden
                  >
                    {q.correct ? <Check className="w-4 h-4 text-white" /> : <X className="w-4 h-4 text-white" />}
                  </span>
                  <p className="font-medium text-slate-900">{q.text}</p>
                </div>

                <div className="mt-3 space-y-1.5 pl-8">
                  {q.options.map((option, idx) => {
                    const isCorrect = idx === q.correctIndex;
                    const isChosen = idx === q.chosenIndex;
                    if (!isCorrect && !isChosen) return null;

                    return (
                      <div
                        key={idx}
                        className={cn(
                          'text-sm rounded-lg px-3 py-1.5 flex items-center justify-between gap-2',
                          isCorrect ? 'bg-success-50 text-success-800' : 'bg-destructive-50 text-destructive-800',
                        )}
                      >
                        <span>{option}</span>
                        <span className="text-xs font-semibold shrink-0">
                          {isCorrect && isChosen && 'You got it right'}
                          {isCorrect && !isChosen && 'The right answer'}
                          {!isCorrect && isChosen && 'You picked this'}
                        </span>
                      </div>
                    );
                  })}
                  {q.chosenIndex === null && (
                    <p className="text-xs text-slate-500">You did not answer this one.</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </ChildLayout>
    );
  }

  // ── The list ────────────────────────────────────────────────────────────────
  return (
    <ChildLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/child/games')}
            aria-label="Back to games"
            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">My games</h1>
            <p className="text-slate-500 text-sm">See how you did and what the answers were</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-xp-500 border-t-transparent" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <History className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">You have not finished a game yet.</p>
            <Button
              size="sm"
              className="mt-4 bg-gold-500 hover:bg-gold-600 text-white"
              onClick={() => router.push('/child/games')}
            >
              <Gamepad2 className="w-4 h-4" /> Play one
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s, i) => (
              <motion.button
                key={s.sessionId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => openReview(s.sessionId)}
                disabled={loadingReview === s.sessionId}
                className="w-full text-left bg-white rounded-2xl p-4 border border-slate-200 hover:border-gold-300 transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 truncate">{s.game.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {GAME_CATEGORY_LABELS[s.game.category]} · {GAME_LEVEL_LABELS[s.game.level]} ·{' '}
                      {playedLabel(s.playedAt)}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span className="flex items-center gap-1 text-gold-600">
                        <Star className="w-3 h-3" />{s.pointsAwarded} pts
                      </span>
                      <span className="flex items-center gap-1 text-xp-600">
                        <Zap className="w-3 h-3" />{s.xpAwarded} XP
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-2xl font-bold', scoreTone(s.correctCount, s.totalQuestions))}>
                      {s.correctCount}/{s.totalQuestions}
                    </p>
                    <p className="text-xs text-slate-400">
                      {loadingReview === s.sessionId ? 'Opening…' : 'See answers'}
                    </p>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </ChildLayout>
  );
}

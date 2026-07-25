'use client';

/**
 * child/games/play - quiz play screen.
 *
 * Rewritten to fix two reported problems:
 *
 *  1. No correct/wrong indicator. The client is still never told an answer in advance - instead
 *     each choice is POSTed to /answer, which commits it and returns whether it was right. The
 *     chosen option turns green or red and the right answer is revealed before advancing.
 *
 *  2. All-or-nothing scoring. Submit now returns a score and a per-question review, so a child who
 *     got 4 of 5 sees which one they missed instead of a bare "better luck next time".
 *
 * Session state also moved server-side: the questions are fetched by session id rather than read
 * from sessionStorage, so a refresh mid-quiz resumes instead of silently abandoning the session.
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Star, Zap, ArrowLeft, Loader2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { gamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import Confetti from 'react-confetti';
import type {
  GameAnswerResult,
  GameQuestion,
  GameQuestionReview,
  GameSessionResume,
  GameSubmitResult,
} from '@taskbuddy/shared';

type GameState = 'loading' | 'playing' | 'submitting' | 'result';

/** How long the right/wrong reveal stays on screen before advancing. */
const REVEAL_MS = 1600;

interface Feedback {
  chosenIndex: number;
  correctIndex: number;
  correct: boolean;
}

function QuizPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') ?? '';
  const { error: showError } = useToast();

  const [state, setState] = useState<GameState>('loading');
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [gameInfo, setGameInfo] = useState<GameSessionResume['game'] | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [locking, setLocking] = useState(false);
  const [result, setResult] = useState<GameSubmitResult | null>(null);

  // Load (or resume) the session from the server.
  useEffect(() => {
    if (!sessionId) {
      router.push('/child/games');
      return;
    }
    let cancelled = false;

    gamesApi
      .getSession(sessionId)
      .then((res) => {
        if (cancelled) return;
        const data = res.data as GameSessionResume;
        setQuestions(data.questions);
        setGameInfo(data.game);
        // Resume at the first unanswered question rather than restarting.
        setCurrentQ(Math.min(data.answeredCount, Math.max(0, data.questions.length - 1)));
        setState('playing');
      })
      .catch((err) => {
        if (cancelled) return;
        // Expired, already submitted, or not ours - the lobby explains the cooldown state.
        showError(err instanceof Error ? err.message : 'Could not load that game');
        router.push('/child/games');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, router, showError]);

  const submit = useCallback(async () => {
    setState('submitting');
    try {
      const res = await gamesApi.submitSession(sessionId);
      setResult(res.data as GameSubmitResult);
      setState('result');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Submission failed');
      router.push('/child/games');
    }
  }, [sessionId, router, showError]);

  const handleSelect = async (displayIndex: number) => {
    // One answer per question: ignore taps while a reveal is showing or a lock is in flight.
    if (feedback !== null || locking) return;
    setLocking(true);

    try {
      const res = await gamesApi.answerQuestion(sessionId, currentQ, displayIndex);
      const { correct, correctIndex } = res.data as GameAnswerResult;
      setFeedback({ chosenIndex: displayIndex, correctIndex, correct });

      // Hold the reveal, then advance or finish.
      setTimeout(() => {
        setFeedback(null);
        if (currentQ + 1 < questions.length) {
          setCurrentQ((c) => c + 1);
        } else {
          void submit();
        }
      }, REVEAL_MS);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save that answer');
    } finally {
      setLocking(false);
    }
  };

  if (state === 'loading') {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-10 h-10 text-xp-500 animate-spin" />
        </div>
      </ChildLayout>
    );
  }

  if (state === 'submitting') {
    return (
      <ChildLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Loader2 className="w-10 h-10 text-xp-500 animate-spin" />
          <p className="text-slate-600">Adding up your score…</p>
        </div>
      </ChildLayout>
    );
  }

  if (state === 'result' && result) {
    return (
      <ChildLayout>
        <ResultScreen result={result} onBack={() => router.push('/child/games')} />
      </ChildLayout>
    );
  }

  const q = questions[currentQ];
  if (!q) return null;

  // Progress counts the question in play, so the bar reaches 100% on the last answer.
  const progress = ((currentQ + (feedback ? 1 : 0)) / questions.length) * 100;

  return (
    <ChildLayout>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/child/games')}
            className="p-2 rounded-lg hover:bg-slate-100"
            aria-label="Back to games"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="flex-1">
            <p className="text-sm text-slate-500">{gameInfo?.title}</p>
            <div className="h-2 bg-slate-200 rounded-full mt-1">
              <motion.div
                className="h-2 bg-xp-500 rounded-full"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
          <span className="text-sm font-medium text-slate-600">
            {currentQ + 1}/{questions.length}
          </span>
        </div>

        {/* Question */}
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
          >
            <p className="font-bold text-slate-900 text-lg mb-6">{q.text}</p>
            <div className="grid grid-cols-1 gap-3">
              {q.options.map((opt, i) => (
                <OptionButton
                  key={i}
                  index={i}
                  label={opt}
                  feedback={feedback}
                  disabled={feedback !== null || locking}
                  onSelect={handleSelect}
                />
              ))}
            </div>

            {/* Inline verdict - the piece that was missing entirely */}
            <AnimatePresence>
              {feedback && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    'mt-4 text-center font-bold',
                    feedback.correct ? 'text-success-600' : 'text-red-500',
                  )}
                >
                  {feedback.correct ? 'Correct! 🎉' : 'Not quite — the right answer is highlighted.'}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>
    </ChildLayout>
  );
}

// ─── Option button ────────────────────────────────────────────────────────────

function OptionButton({
  index,
  label,
  feedback,
  disabled,
  onSelect,
}: {
  index: number;
  label: string;
  feedback: Feedback | null;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  const isChosen = feedback?.chosenIndex === index;
  const isAnswer = feedback?.correctIndex === index;

  // Before answering: neutral. After: green on the right answer (always shown, so a child who got
  // it wrong still learns it), red only on a wrong choice they actually made.
  const stateClasses = !feedback
    ? 'border-slate-200 hover:border-xp-400 hover:bg-xp-50'
    : isAnswer
      ? 'border-success-500 bg-success-50 text-success-800'
      : isChosen
        ? 'border-red-400 bg-red-50 text-red-700'
        : 'border-slate-200 opacity-50';

  return (
    <button
      onClick={() => onSelect(index)}
      disabled={disabled}
      className={cn(
        'p-4 rounded-xl border-2 text-left font-medium transition-all flex items-center gap-3',
        stateClasses,
      )}
    >
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs font-bold shrink-0">
        {String.fromCharCode(65 + index)}
      </span>
      <span className="flex-1">{label}</span>
      {feedback && isAnswer && <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />}
      {feedback && isChosen && !isAnswer && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
    </button>
  );
}

// ─── Result screen ────────────────────────────────────────────────────────────

function ResultScreen({ result, onBack }: { result: GameSubmitResult; onBack: () => void }) {
  const { correctCount, totalQuestions, pointsAwarded, xpAwarded, cappedMessage, review } = result;
  const perfect = correctCount === totalQuestions;
  const scored = pointsAwarded > 0;

  return (
    <>
      {perfect && <Confetti recycle={false} numberOfPieces={200} />}
      <div className="max-w-md mx-auto py-8 space-y-6">
        <div className="text-center">
          {scored ? (
            <Trophy className="w-16 h-16 text-gold-500 mx-auto mb-4" />
          ) : (
            <XCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          )}

          <h2 className="font-display text-2xl font-bold text-slate-900 mb-1">
            {perfect
              ? 'Perfect score! 🎉'
              : scored
                ? 'Nice work!'
                : 'Good try!'}
          </h2>
          <p className="text-slate-500 mb-4">
            You got <span className="font-bold text-slate-900">{correctCount}</span> of{' '}
            {totalQuestions} right
          </p>

          <div className="flex justify-center gap-6 mb-2">
            <div className="text-center">
              <p className="text-3xl font-bold text-gold-600">+{pointsAwarded}</p>
              <p className="text-sm text-slate-500 flex items-center gap-1 justify-center">
                <Star className="w-3.5 h-3.5" /> pts
              </p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-xp-600">+{xpAwarded}</p>
              <p className="text-sm text-slate-500 flex items-center gap-1 justify-center">
                <Zap className="w-3.5 h-3.5" /> XP
              </p>
            </div>
          </div>

          {cappedMessage && <p className="text-sm text-amber-600">{cappedMessage}</p>}
        </div>

        {/* Per-question review - so a wrong answer teaches something */}
        <div className="space-y-3">
          <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide text-slate-500">
            Review
          </h3>
          {review.map((r) => (
            <ReviewRow key={r.questionIndex} row={r} />
          ))}
        </div>

        <Button onClick={onBack} fullWidth>
          <ArrowLeft className="w-4 h-4" /> Back to Games
        </Button>
      </div>
    </>
  );
}

function ReviewRow({ row }: { row: GameQuestionReview }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        row.correct ? 'border-success-200 bg-success-50/50' : 'border-red-200 bg-red-50/50',
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        {row.correct ? (
          <CheckCircle2 className="w-4 h-4 text-success-600 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        )}
        <p className="font-medium text-slate-900 text-sm">{row.text}</p>
      </div>
      <div className="pl-6 space-y-0.5 text-sm">
        {!row.correct && (
          <p className="text-red-600">
            You said:{' '}
            <span className="font-medium">
              {row.chosenIndex === null ? '—' : row.options[row.chosenIndex]}
            </span>
          </p>
        )}
        <p className="text-success-700">
          Answer: <span className="font-medium">{row.options[row.correctIndex]}</span>
        </p>
      </div>
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <ChildLayout>
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-10 h-10 text-xp-500 animate-spin" />
          </div>
        </ChildLayout>
      }
    >
      <QuizPageInner />
    </Suspense>
  );
}

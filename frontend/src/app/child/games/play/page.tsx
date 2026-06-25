'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Star, Zap, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { gamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import Confetti from 'react-confetti';

interface Question {
  id: string;
  text: string;
  options: string[];
}

interface GameInfo {
  title: string;
  difficulty: string;
  pointsReward: number;
  xpReward: number;
}

type GameState = 'loading' | 'playing' | 'submitting' | 'result';

function QuizPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') ?? '';
  const { error: showError } = useToast();

  const [state, setState] = useState<GameState>('loading');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; pointsAwarded: number; xpAwarded: number; cappedMessage?: string } | null>(null);

  useEffect(() => {
    if (!sessionId) { router.push('/child/games'); return; }
    // Fetch questions from session start (stored in sessionStorage by lobby page)
    const stored = sessionStorage.getItem(`game-session-${sessionId}`);
    if (stored) {
      const { questions: q, game } = JSON.parse(stored);
      setQuestions(q);
      setGameInfo(game);
      setState('playing');
    } else {
      router.push('/child/games');
    }
  }, [sessionId, router]);

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setTimeout(() => {
      const newAnswers = [...answers, idx];
      setAnswers(newAnswers);

      if (currentQ + 1 < questions.length) {
        setCurrentQ((c) => c + 1);
        setSelected(null);
      } else {
        // All answered - submit
        setState('submitting');
        gamesApi.submitSession(sessionId, newAnswers)
          .then((res) => {
            setResult(res.data as any);
            setState('result');
            sessionStorage.removeItem(`game-session-${sessionId}`);
          })
          .catch((err) => {
            showError(err instanceof Error ? err.message : 'Submission failed');
            router.push('/child/games');
          });
      }
    }, 600);
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
          <p className="text-slate-600">Checking your answers…</p>
        </div>
      </ChildLayout>
    );
  }

  if (state === 'result' && result) {
    return (
      <ChildLayout>
        {result.correct && <Confetti recycle={false} numberOfPieces={200} />}
        <div className="max-w-md mx-auto text-center py-12">
          {result.correct ? (
            <>
              <CheckCircle2 className="w-16 h-16 text-success-500 mx-auto mb-4" />
              <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">Great job! 🎉</h2>
              <div className="flex justify-center gap-6 mb-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-gold-600">+{result.pointsAwarded}</p>
                  <p className="text-sm text-slate-500 flex items-center gap-1"><Star className="w-3.5 h-3.5" /> pts</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-xp-600">+{result.xpAwarded}</p>
                  <p className="text-sm text-slate-500 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> XP</p>
                </div>
              </div>
              {result.cappedMessage && <p className="text-sm text-amber-600 mb-4">{result.cappedMessage}</p>}
            </>
          ) : (
            <>
              <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">Better luck next time!</h2>
              <p className="text-slate-500 mb-4">Review the topics and try again after the cooldown.</p>
            </>
          )}
          <Button onClick={() => router.push('/child/games')} fullWidth>
            <ArrowLeft className="w-4 h-4" /> Back to Games
          </Button>
        </div>
      </ChildLayout>
    );
  }

  const q = questions[currentQ];

  return (
    <ChildLayout>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/child/games')} className="p-2 rounded-lg hover:bg-slate-100">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="flex-1">
            <p className="text-sm text-slate-500">{gameInfo?.title}</p>
            <div className="h-2 bg-slate-200 rounded-full mt-1">
              <div
                className="h-2 bg-xp-500 rounded-full transition-all"
                style={{ width: `${((currentQ) / questions.length) * 100}%` }}
              />
            </div>
          </div>
          <span className="text-sm font-medium text-slate-600">{currentQ + 1}/{questions.length}</span>
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
                <button
                  key={i}
                  onClick={() => handleSelect(i)}
                  disabled={selected !== null}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left font-medium transition-all',
                    selected === null
                      ? 'border-slate-200 hover:border-xp-400 hover:bg-xp-50'
                      : selected === i
                      ? 'border-xp-500 bg-xp-50 text-xp-700'
                      : 'border-slate-200 opacity-50'
                  )}
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs font-bold mr-3">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </ChildLayout>
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={
      <ChildLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-10 h-10 text-xp-500 animate-spin" />
        </div>
      </ChildLayout>
    }>
      <QuizPageInner />
    </Suspense>
  );
}

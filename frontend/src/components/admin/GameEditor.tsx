'use client';

/**
 * components/admin/GameEditor - author a game definition and its question bank.
 *
 * Opened as a modal from /admin/games. Handles both create (gameId === null) and edit.
 *
 * The correct answer is picked with a radio per option rather than a numeric "correctIndex" field:
 * the index is an implementation detail, and typing it by hand is how you get an out-of-range value
 * that makes a question impossible to answer. The server validates the bank again regardless.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  GAME_CATEGORIES,
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  GAME_LEVELS,
  type GameCategory,
  type GameLevel,
} from '@taskbuddy/shared';
import { adminGamesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import type { AdminGameDetail, AdminGameQuestion } from '@taskbuddy/shared';

const AGE_GROUPS = ['10-12', '13-16'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

interface FormState {
  title: string;
  description: string;
  category: GameCategory;
  level: GameLevel;
  difficulty: (typeof DIFFICULTIES)[number];
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  ageGroup: string; // '' = all ages
  questionsPerSession: number;
  isActive: boolean;
  questions: AdminGameQuestion[];
}

const BLANK: FormState = {
  title: '',
  description: '',
  category: 'maths',
  level: 'beginner',
  difficulty: 'easy',
  pointsReward: 20,
  xpReward: 10,
  cooldownHours: 24,
  ageGroup: '',
  questionsPerSession: 5,
  isActive: true,
  questions: [],
};

function blankQuestion(index: number): AdminGameQuestion {
  return {
    // Stable, unique, and readable in the DB. Timestamped so it cannot collide with existing ids.
    id: `q${Date.now().toString(36)}${index}`,
    text: '',
    options: ['', ''],
    correctIndex: 0,
  };
}

export function GameEditor({
  gameId,
  onClose,
}: {
  gameId: string | null;
  onClose: (changed: boolean) => void;
}) {
  const { error: showError, success: showSuccess } = useToast();
  const [form, setForm] = useState<FormState>(BLANK);
  const [isLoading, setIsLoading] = useState(gameId !== null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    adminGamesApi
      .get(gameId)
      .then((res) => {
        if (cancelled) return;
        const g = (res.data as { game: AdminGameDetail }).game;
        setForm({
          title: g.title,
          description: g.description ?? '',
          category: g.category,
          level: g.level,
          difficulty: g.difficulty,
          pointsReward: g.pointsReward,
          xpReward: g.xpReward,
          cooldownHours: g.cooldownHours,
          ageGroup: g.ageGroup ?? '',
          questionsPerSession: g.questionsPerSession,
          isActive: g.isActive,
          questions: g.questions,
        });
      })
      .catch(() => {
        if (!cancelled) {
          showError('Failed to load game');
          onClose(false);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, showError, onClose]);

  const patchQuestion = useCallback((index: number, patch: Partial<AdminGameQuestion>) => {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));
  }, []);

  const addOption = (qIndex: number) => {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qIndex ? { ...q, options: [...q.options, ''] } : q,
      ),
    }));
  };

  const removeOption = (qIndex: number, optIndex: number) => {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => {
        if (i !== qIndex) return q;
        const options = q.options.filter((_, oi) => oi !== optIndex);
        // Keep the answer pointing at the same option, and never leave it out of range.
        let correctIndex = q.correctIndex;
        if (optIndex < correctIndex) correctIndex--;
        else if (optIndex === correctIndex) correctIndex = 0;
        return { ...q, options, correctIndex: Math.min(correctIndex, options.length - 1) };
      }),
    }));
  };

  // Mirrors the server's rules so problems surface before a round trip.
  const problems: string[] = [];
  if (form.title.trim() === '') problems.push('Title is required.');
  if (form.questions.length === 0) problems.push('Add at least one question.');
  form.questions.forEach((q, i) => {
    if (q.text.trim() === '') problems.push(`Question ${i + 1}: text is required.`);
    if (q.options.length < 2) problems.push(`Question ${i + 1}: at least 2 options.`);
    if (q.options.some((o) => o.trim() === '')) problems.push(`Question ${i + 1}: blank option.`);
  });
  if (form.questionsPerSession > form.questions.length && form.questions.length > 0) {
    problems.push(
      `Questions per session (${form.questionsPerSession}) cannot exceed the bank size (${form.questions.length}).`,
    );
  }

  const rotationNote =
    form.questions.length > 0 && form.questionsPerSession >= form.questions.length
      ? 'The bank is not bigger than one play, so every day will serve the same questions.'
      : null;

  const handleSave = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        level: form.level,
        difficulty: form.difficulty,
        pointsReward: form.pointsReward,
        xpReward: form.xpReward,
        cooldownHours: form.cooldownHours,
        ageGroup: form.ageGroup || null,
        questionsPerSession: form.questionsPerSession,
        isActive: form.isActive,
        questions: form.questions.map((q) => ({
          ...q,
          text: q.text.trim(),
          options: q.options.map((o) => o.trim()),
        })),
      };

      if (gameId) {
        await adminGamesApi.update(gameId, payload);
        showSuccess('Game updated');
      } else {
        await adminGamesApi.create({ ...payload, type: 'quiz' });
        showSuccess('Game created');
      }
      onClose(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save game');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">
            {gameId ? 'Edit game' : 'New game'}
          </h3>
          <button
            onClick={() => onClose(false)}
            className="text-slate-400 hover:text-slate-600 text-sm"
          >
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading…</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Metadata */}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Title" className="sm:col-span-2">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputClass}
                  placeholder="Math Challenge"
                />
              </Field>

              <Field label="Description" className="sm:col-span-2">
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputClass}
                  placeholder="Test your arithmetic skills!"
                />
              </Field>

              {/* The two axes a child actually picks from. Both are required. */}
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as GameCategory })
                  }
                  className={inputClass}
                >
                  {GAME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {GAME_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Level">
                <select
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value as GameLevel })}
                  className={inputClass}
                >
                  {GAME_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {GAME_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
              </Field>

              {/*
                Legacy axis, superseded by Level. Kept visible only because existing rows carry a value;
                nothing reads it for gameplay.
              */}
              <Field label="Difficulty (legacy)">
                <select
                  value={form.difficulty}
                  onChange={(e) =>
                    setForm({ ...form, difficulty: e.target.value as FormState['difficulty'] })
                  }
                  className={inputClass}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Age group">
                <select
                  value={form.ageGroup}
                  onChange={(e) => setForm({ ...form, ageGroup: e.target.value })}
                  className={inputClass}
                >
                  <option value="">All ages</option>
                  {AGE_GROUPS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Points reward">
                <input
                  type="number"
                  min={0}
                  value={form.pointsReward}
                  onChange={(e) => setForm({ ...form, pointsReward: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>

              <Field label="XP reward">
                <input
                  type="number"
                  min={0}
                  value={form.xpReward}
                  onChange={(e) => setForm({ ...form, xpReward: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>

              <Field label="Cooldown (hours)">
                <input
                  type="number"
                  min={1}
                  value={form.cooldownHours}
                  onChange={(e) => setForm({ ...form, cooldownHours: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Questions per play"
                hint={`Bank has ${form.questions.length}`}
              >
                <input
                  type="number"
                  min={1}
                  value={form.questionsPerSession}
                  onChange={(e) =>
                    setForm({ ...form, questionsPerSession: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </Field>
            </div>

            {rotationNote && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {rotationNote}
              </p>
            )}

            {/* Question bank */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700">
                  Question bank ({form.questions.length})
                </h4>
                <button
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      questions: [...f.questions, blankQuestion(f.questions.length)],
                    }))
                  }
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  + Add question
                </button>
              </div>

              <div className="space-y-4">
                {form.questions.map((q, qi) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start gap-2 mb-3">
                      <span className="text-xs font-semibold text-slate-400 mt-2.5 w-6 shrink-0">
                        {qi + 1}
                      </span>
                      <input
                        value={q.text}
                        onChange={(e) => patchQuestion(qi, { text: e.target.value })}
                        className={inputClass}
                        placeholder="What is 7 × 8?"
                      />
                      <button
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            questions: f.questions.filter((_, i) => i !== qi),
                          }))
                        }
                        className="text-xs text-red-500 hover:text-red-600 mt-2.5 shrink-0"
                      >
                        Remove
                      </button>
                    </div>

                    <p className="text-xs text-slate-400 mb-2 pl-8">
                      Select the correct answer
                    </p>
                    <div className="space-y-2 pl-8">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct-${q.id}`}
                            checked={q.correctIndex === oi}
                            onChange={() => patchQuestion(qi, { correctIndex: oi })}
                            className="w-4 h-4 text-indigo-600 shrink-0"
                            aria-label={`Option ${oi + 1} is correct`}
                          />
                          <input
                            value={opt}
                            onChange={(e) =>
                              patchQuestion(qi, {
                                options: q.options.map((o, i) => (i === oi ? e.target.value : o)),
                              })
                            }
                            className={inputClass}
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                          />
                          {q.options.length > 2 && (
                            <button
                              onClick={() => removeOption(qi, oi)}
                              className="text-xs text-slate-400 hover:text-red-500 shrink-0"
                              aria-label={`Remove option ${oi + 1}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      {q.options.length < 6 && (
                        <button
                          onClick={() => addOption(qi)}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          + Add option
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {problems.length > 0 && (
              <ul className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
                {problems.slice(0, 6).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
                {problems.length > 6 && <li>…and {problems.length - 6} more.</li>}
              </ul>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={() => onClose(false)}
            className="rounded-lg border border-slate-200 text-slate-600 text-sm px-4 py-2 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || problems.length > 0 || isLoading}
            className="rounded-lg bg-indigo-600 text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : gameId ? 'Save changes' : 'Create game'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-500 mb-1">
        {label}
        {hint && <span className="ml-1 text-slate-400 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

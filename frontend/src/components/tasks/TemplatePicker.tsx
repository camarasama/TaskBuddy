'use client';

/**
 * components/tasks/TemplatePicker — browse starter task packs (growth roadmap §3.1).
 *
 * The roadmap's #1 activation item: a blank task list at signup demands creative effort from a
 * parent at the moment they have least patience, and that is the biggest measured drop-off.
 *
 * Two ways out of this screen, and the distinction matters:
 *  - **Use one template** → pre-fills the create form so the parent can EDIT before submitting.
 *    Nothing is created until they submit; editing never mutates the template.
 *  - **Add the whole pack** → creates every task in the family's library at once, assigning only up
 *    to the child's remaining capacity. CR-10 caps a child at 3 active assignments, so the response
 *    says how many were held back and the UI repeats it rather than quietly dropping them.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Plus, Clock, Star, Camera, Loader2, X } from 'lucide-react';
import { templatesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { ApplyPackResult, TaskTemplateRow, TemplatePack } from '@taskbuddy/shared';

interface Props {
  /** Filters templates to what suits this child's real date of birth, when chosen. */
  childId?: string;
  /** Pre-fill the create form with this template. The parent edits, then submits. */
  onUseTemplate: (template: TaskTemplateRow) => void;
  onClose: () => void;
  /** Called after a pack lands, so the caller can refresh its task list. */
  onPackApplied?: (result: ApplyPackResult) => void;
}

export function TemplatePicker({ childId, onUseTemplate, onClose, onPackApplied }: Props) {
  const { success: showSuccess, error: showError } = useToast();
  const [packs, setPacks] = useState<TemplatePack[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TaskTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    templatesApi
      .packs()
      .then((res) => {
        const rows = (res.data as { packs: TemplatePack[] }).packs;
        setPacks(rows);
        setActivePack((current) => current ?? rows[0]?.category ?? null);
      })
      .catch(() => showError('Could not load starter packs'))
      .finally(() => setLoading(false));
  }, [showError]);

  const loadTemplates = useCallback(
    (category: string) => {
      templatesApi
        .tasks({ category, childId })
        .then((res) => setTemplates((res.data as { templates: TaskTemplateRow[] }).templates))
        .catch(() => showError('Could not load templates'));
    },
    [childId, showError],
  );

  useEffect(() => {
    if (activePack) loadTemplates(activePack);
  }, [activePack, loadTemplates]);

  const handleApplyPack = async () => {
    if (!activePack) return;
    setApplying(true);
    try {
      const res = await templatesApi.applyPack(activePack, childId);
      const result = res.data as ApplyPackResult;
      // The message already explains any capacity hold-back in plain words.
      showSuccess(result.message);
      onPackApplied?.(result);
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not add that pack');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-gold-500" />
              Starter packs
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Pick one to edit, or add a whole pack at once.
              {childId && ' Only tasks suited to this child are shown.'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : (
          <>
            {/* Pack tabs */}
            <div className="px-6 pt-4 overflow-x-auto">
              <div className="flex gap-2 min-w-max pb-1">
                {packs.map((pack) => (
                  <button
                    key={pack.category}
                    onClick={() => setActivePack(pack.category)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                      activePack === pack.category
                        ? 'bg-primary-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {pack.category}
                    <span className="ml-1.5 opacity-70">{pack.templateCount}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Templates */}
            <div className="p-6 pt-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {templates.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  No templates here for this child’s age.
                </p>
              ) : (
                templates.map((t, i) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.2) }}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3 hover:border-primary-300 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{t.name}</p>
                      {t.description && (
                        <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-gold-500" />
                          {t.suggestedPoints} pts
                        </span>
                        {t.estimatedMinutes && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {t.estimatedMinutes} min
                          </span>
                        )}
                        {t.requiresPhotoEvidence && (
                          <span className="flex items-center gap-1">
                            <Camera className="w-3 h-3" />
                            photo
                          </span>
                        )}
                        {t.ageRange && <span className="text-slate-400">{t.ageRange}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onUseTemplate(t);
                        onClose();
                      }}
                      className="shrink-0 rounded-lg border border-primary-200 text-primary-600 text-sm font-medium px-3 py-1.5 hover:bg-primary-50 transition-colors"
                    >
                      Use
                    </button>
                  </motion.div>
                ))
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Adding a pack creates every task in your library. A child can have 3 active tasks at
                a time, so the rest wait their turn.
              </p>
              <button
                onClick={handleApplyPack}
                disabled={applying || !activePack || templates.length === 0}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium px-4 py-2 hover:bg-primary-700 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add whole pack
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

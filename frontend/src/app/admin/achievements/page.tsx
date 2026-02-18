/**
 * app/admin/achievements/page.tsx — M8
 *
 * Global achievement management. Admin can create, edit, and delete
 * system achievements that apply across all families.
 * Each achievement card shows its unlock count so admin can see popularity.
 */

'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';

interface Achievement {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  category: string | null;
  tier: string | null;
  pointsReward: number;
  xpReward: number;
  unlockCriteriaType: string | null;
  unlockCriteriaValue: number | null;
  isSystemAchievement: boolean;
  createdAt: string;
  _count: { childAchievements: number };
}

const TIER_COLORS: Record<string, string> = {
  bronze:   'bg-orange-100 text-orange-700 border-orange-200',
  silver:   'bg-slate-100 text-slate-600 border-slate-200',
  gold:     'bg-yellow-100 text-yellow-700 border-yellow-200',
  platinum: 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

const EMPTY_FORM = {
  name: '', description: '', iconUrl: '', category: '',
  tier: '', pointsReward: 0, xpReward: 0,
  unlockCriteriaType: '', unlockCriteriaValue: '',
};

export default function AdminAchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Achievement | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAchievements();
      setAchievements((res.data as any).achievements);
    } catch {
      setError('Failed to load achievements.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(a: Achievement) {
    setEditTarget(a);
    setForm({
      name: a.name,
      description: a.description || '',
      iconUrl: a.iconUrl || '',
      category: a.category || '',
      tier: a.tier || '',
      pointsReward: a.pointsReward,
      xpReward: a.xpReward,
      unlockCriteriaType: a.unlockCriteriaType || '',
      unlockCriteriaValue: String(a.unlockCriteriaValue ?? ''),
    });
    setFormError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const payload: Record<string, any> = {
      name: form.name.trim(),
      description: form.description || undefined,
      iconUrl: form.iconUrl || undefined,
      category: form.category || undefined,
      tier: form.tier || undefined,
      pointsReward: Number(form.pointsReward) || 0,
      xpReward: Number(form.xpReward) || 0,
      unlockCriteriaType: form.unlockCriteriaType || undefined,
      unlockCriteriaValue: form.unlockCriteriaValue ? Number(form.unlockCriteriaValue) : undefined,
    };

    try {
      if (editTarget) {
        await adminApi.updateAchievement(editTarget.id, payload);
      } else {
        await adminApi.createAchievement(payload);
      }
      setShowModal(false);
      load();
    } catch (err: any) {
      setFormError(err?.data?.error?.message || 'Failed to save achievement.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(a: Achievement) {
    if (!window.confirm(
      `Delete "${a.name}"? This will also remove it from ${a._count.childAchievements} children who have unlocked it. This cannot be undone.`
    )) return;

    try {
      await adminApi.deleteAchievement(a.id);
      load();
    } catch {
      setError('Failed to delete achievement.');
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Achievements</h2>
          <p className="text-slate-500 text-sm mt-1">
            Global achievements that apply across all families.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + New Achievement
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Achievement grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="h-5 w-32 bg-slate-100 rounded mb-2" />
              <div className="h-4 w-48 bg-slate-100 rounded mb-4" />
              <div className="h-4 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : achievements.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          No achievements yet. Create your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {achievements.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {a.iconUrl ? (
                    <img src={a.iconUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-base">
                      🏆
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{a.name}</div>
                    {a.tier && (
                      <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${TIER_COLORS[a.tier] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {a.tier}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {a.description && (
                <p className="text-xs text-slate-500 mb-3 line-clamp-2">{a.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-400 mb-4">
                <span>⭐ {a.xpReward} XP</span>
                <span>🪙 {a.pointsReward} pts</span>
                <span>👥 {a._count.childAchievements} unlocked</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(a)}
                  className="flex-1 text-xs text-indigo-600 border border-indigo-200 hover:bg-indigo-50 py-1.5 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(a)}
                  className="flex-1 text-xs text-red-600 border border-red-200 hover:bg-red-50 py-1.5 rounded-lg transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-800 mb-5">
              {editTarget ? 'Edit Achievement' : 'New Achievement'}
            </h3>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              {[
                { label: 'Name *', key: 'name', placeholder: 'e.g. First Task' },
                { label: 'Description', key: 'description', placeholder: 'What does the child need to do?' },
                { label: 'Icon URL', key: 'iconUrl', placeholder: 'https://…' },
                { label: 'Category', key: 'category', placeholder: 'e.g. tasks, streaks' },
                { label: 'Unlock Criteria Type', key: 'unlockCriteriaType', placeholder: 'e.g. tasks_completed' },
                { label: 'Unlock Criteria Value', key: 'unlockCriteriaValue', placeholder: 'e.g. 10' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    value={(form as any)[key]}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tier</label>
                  <select
                    value={form.tier}
                    onChange={(e) => setForm((p) => ({ ...p, tier: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">None</option>
                    <option value="bronze">Bronze</option>
                    <option value="silver">Silver</option>
                    <option value="gold">Gold</option>
                    <option value="platinum">Platinum</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">XP Reward</label>
                  <input
                    type="number" min={0}
                    value={form.xpReward}
                    onChange={(e) => setForm((p) => ({ ...p, xpReward: Number(e.target.value) }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Points Reward</label>
                  <input
                    type="number" min={0}
                    value={form.pointsReward}
                    onChange={(e) => setForm((p) => ({ ...p, pointsReward: Number(e.target.value) }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Achievement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

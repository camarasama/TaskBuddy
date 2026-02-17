'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Users,
  Bell,
  Shield,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  UserPlus,
  Crown,
  Trash2,
  Mail,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { familyApi, authApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { InviteCoParentModal } from '@/components/InviteCoParentModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Family {
  id: string;
  familyName: string;
  familyCode?: string;
  settings?: {
    autoApproveRecurringTasks: boolean;
    enableDailyChallenges: boolean;
    enableLeaderboard: boolean;
    streakGracePeriodHours: number;
  };
}

interface FamilySettingsData {
  autoApproveRecurringTasks: boolean;
  enableDailyChallenges: boolean;
  enableLeaderboard: boolean;
  streakGracePeriodHours: number;
}

interface ParentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isPrimaryParent: boolean;
  avatarUrl?: string;
  lastLoginAt?: string;
}

interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
  invitedBy: { firstName: string; lastName: string };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParentSettingsPage() {
  const { user, logout } = useAuth();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  // M4 state
  const [parents, setParents] = useState<ParentUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [removingParentId, setRemovingParentId] = useState<string | null>(null);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

  const [familyCode, setFamilyCode] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familySettings, setFamilySettings] = useState<FamilySettingsData>({
    autoApproveRecurringTasks: false,
    enableDailyChallenges: true,
    enableLeaderboard: false,
    streakGracePeriodHours: 4,
  });

  // Whether the logged-in user is the primary parent — only used to show/hide
  // the Remove button on co-parent rows. Defaults true so it doesn't flicker.
  const currentUserIsPrimary = parents.find((p) => p.id === user?.id)?.isPrimaryParent ?? true;

  // ── Data loading ────────────────────────────────────────────────────────

  const loadParents = useCallback(async () => {
    try {
      const res = await familyApi.getParents();
      const { parents: p, pendingInvites: pi } = res.data as {
        parents: ParentUser[];
        pendingInvites: PendingInvite[];
      };
      setParents(p || []);
      setPendingInvites(pi || []);
    } catch {
      // Non-fatal — section just won't show
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [familyRes, settingsRes] = await Promise.all([
        familyApi.getFamily(),
        familyApi.getSettings(),
      ]);

      const familyData = (familyRes.data as { family: Family }).family;
      if (familyData) {
        setFamilyName(familyData.familyName || '');
        setFamilyCode(familyData.familyCode || familyData.id);
      }

      const settingsData = (settingsRes.data as { settings: FamilySettingsData }).settings;
      if (settingsData) {
        setFamilySettings({
          autoApproveRecurringTasks: settingsData.autoApproveRecurringTasks ?? false,
          enableDailyChallenges: settingsData.enableDailyChallenges ?? true,
          enableLeaderboard: settingsData.enableLeaderboard ?? false,
          streakGracePeriodHours: settingsData.streakGracePeriodHours ?? 4,
        });
      }
    } catch {
      showError('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadData();
    loadParents();
  }, [loadData, loadParents]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        familyApi.updateFamily({ familyName }),
        familyApi.updateSettings(familySettings),
      ]);
      showSuccess('Settings saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const copyFamilyCode = () => {
    if (familyCode) {
      navigator.clipboard.writeText(familyCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showSuccess('Family code copied!');
    }
  };

  const handleRegenerateCode = async () => {
    setIsRegenerating(true);
    setShowRegenerateConfirm(false);
    try {
      const result = await authApi.regenerateFamilyCode();
      const newCode = (result.data as { familyCode: string }).familyCode;
      setFamilyCode(newCode);
      showSuccess('Family code regenerated! Share the new code with your children.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate code';
      showError(message);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRemoveParent = async (parentId: string) => {
    setRemovingParentId(parentId);
    try {
      await familyApi.removeParent(parentId);
      showSuccess('Co-parent removed from family');
      await loadParents();
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || err?.message || 'Failed to remove co-parent';
      showError(message);
    } finally {
      setRemovingParentId(null);
    }
  };

  const handleCancelInvite = async (invitationId: string) => {
    setCancellingInviteId(invitationId);
    try {
      await familyApi.cancelInvite(invitationId);
      showSuccess('Invitation cancelled');
      await loadParents();
    } catch (err: any) {
      const message = err?.response?.data?.error?.message || err?.message || 'Failed to cancel invitation';
      showError(message);
    } finally {
      setCancellingInviteId(null);
    }
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ParentLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-600 mt-1">Manage your family settings</p>
        </div>

        {/* Family Info */}
        <section className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary-600" />
            </div>
            <h2 className="font-display font-bold text-lg text-slate-900">
              Family Information
            </h2>
          </div>

          <div className="space-y-4">
            <Input
              label="Family Name"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
            />

            {/* Family Code — readable format, copy + regenerate */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Family Code
              </label>
              <div className="flex gap-2">
                <Input
                  value={familyCode}
                  readOnly
                  className="font-mono text-sm tracking-wider uppercase"
                />
                <Button
                  variant="secondary"
                  onClick={copyFamilyCode}
                  title="Copy family code"
                >
                  {copied ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Share this code with your children so they can log in
              </p>

              {/* Regenerate Code */}
              {!showRegenerateConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowRegenerateConfirm(true)}
                  className="mt-2 text-sm text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
                >
                  Regenerate code
                </button>
              ) : (
                <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      <strong>Warning:</strong> Regenerating your code will invalidate the old one.
                      Your children will need the new code to log in on new devices.
                      Existing logged-in sessions are not affected.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowRegenerateConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRegenerateCode}
                      loading={isRegenerating}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      Yes, regenerate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── M4: Family Members (co-parents) ── */}
        <section className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-violet-600" />
              </div>
              <h2 className="font-display font-bold text-lg text-slate-900">
                Family Members
              </h2>
            </div>
            <Button
              size="sm"
              onClick={() => setShowInviteModal(true)}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Adult
            </Button>
          </div>

          <div className="space-y-3">
            {/* Active parents */}
            {parents.map((parent) => (
              <div
                key={parent.id}
                className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar initials */}
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-sm font-semibold text-primary-700 flex-shrink-0">
                    {parent.firstName[0]}{parent.lastName[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">
                        {parent.firstName} {parent.lastName}
                      </span>
                      {parent.isPrimaryParent && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          <Crown className="w-3 h-3" />
                          Primary
                        </span>
                      )}
                      {parent.id === user?.id && (
                        <span className="text-xs text-slate-400">(you)</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{parent.email}</p>
                  </div>
                </div>

                {/* Remove button — only primary parent can remove; cannot remove self */}
                {currentUserIsPrimary && !parent.isPrimaryParent && parent.id !== user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveParent(parent.id)}
                    loading={removingParentId === parent.id}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}

            {/* Pending invitations */}
            {pendingInvites.length > 0 && (
              <>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide pt-2">
                  Pending Invitations
                </p>
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <Mail className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{invite.email}</p>
                      <p className="text-xs text-slate-400">
                        Invited by {invite.invitedBy.firstName} · expires{' '}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full flex-shrink-0">
                      Pending
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCancelInvite(invite.id)}
                      loading={cancellingInviteId === invite.id}
                      title="Cancel invitation"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </>
            )}

            {parents.length === 0 && pendingInvites.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">
                No other parents yet. Invite a co-parent above.
              </p>
            )}
          </div>
        </section>

        {/* Task Settings */}
        <section className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-success-100 flex items-center justify-center">
              <Settings className="w-5 h-5 text-success-600" />
            </div>
            <h2 className="font-display font-bold text-lg text-slate-900">
              Task Settings
            </h2>
          </div>

          <div className="space-y-4">
            <ToggleSetting
              label="Auto-approve Recurring Tasks"
              description="Automatically approve recurring tasks when completed"
              checked={familySettings.autoApproveRecurringTasks}
              onChange={(checked) => setFamilySettings({ ...familySettings, autoApproveRecurringTasks: checked })}
            />
            <ToggleSetting
              label="Enable Daily Challenges"
              description="Show daily challenge tasks for children"
              checked={familySettings.enableDailyChallenges}
              onChange={(checked) => setFamilySettings({ ...familySettings, enableDailyChallenges: checked })}
            />
            <ToggleSetting
              label="Enable Leaderboard"
              description="Show a leaderboard ranking among siblings"
              checked={familySettings.enableLeaderboard}
              onChange={(checked) => setFamilySettings({ ...familySettings, enableLeaderboard: checked })}
            />
          </div>
        </section>

        {/* Gamification Settings */}
        <section className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-gold-100 flex items-center justify-center">
              <Bell className="w-5 h-5 text-gold-600" />
            </div>
            <h2 className="font-display font-bold text-lg text-slate-900">
              Gamification
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Streak Grace Period (hours)
              </label>
              <Input
                type="number"
                min={0}
                max={12}
                value={familySettings.streakGracePeriodHours}
                onChange={(e) =>
                  setFamilySettings({
                    ...familySettings,
                    streakGracePeriodHours: parseInt(e.target.value) || 0,
                  })
                }
              />
              <p className="text-sm text-slate-500 mt-1">
                Extra hours before a streak is broken (0-12)
              </p>
            </div>
          </div>
        </section>

        {/* Account Info */}
        <section className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Shield className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="font-display font-bold text-lg text-slate-900">
              Account
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500">Logged in as</p>
              <p className="font-medium text-slate-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-sm text-slate-500">{user?.email}</p>
            </div>

            <ChangePasswordForm />

            <Button variant="destructive" onClick={logout}>
              Sign Out
            </Button>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button size="lg" onClick={handleSave} loading={isSaving}>
            Save Changes
          </Button>
        </div>
      </div>

      {/* Invite Co-Parent Modal */}
      {showInviteModal && (
        <InviteCoParentModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={async () => {
            setShowInviteModal(false);
            await loadParents();
          }}
        />
      )}
    </ParentLayout>
  );
}

// ─── Change Password Form ──────────────────────────────────────────────────────

function ChangePasswordForm() {
  const { error: showError, success: showSuccess } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      showError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      showError('New passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      showSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Change Password
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
      <h3 className="font-medium text-slate-900">Change Password</h3>
      <Input
        label="Current Password"
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
      />
      <Input
        label="New Password"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        placeholder="At least 8 characters"
      />
      <Input
        label="Confirm New Password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isSubmitting}>
          Update Password
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsOpen(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Toggle Setting ────────────────────────────────────────────────────────────

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
      <div>
        <p className="font-medium text-slate-900">{label}</p>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <input
        type="checkbox"
        className="w-5 h-5 rounded text-primary-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
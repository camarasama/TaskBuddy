'use client';
import { useDataRefresh } from '@/hooks/useDataRefresh';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  User,
  Star,
  Trophy,
  Edit2,
  Trash2,
  Key,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { ResetPinModal } from '@/components/ResetPinModal';
import { AvatarUpload } from '@/components/AvatarUpload';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';
import { getInitials, formatPoints } from '@/lib/utils';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  username?: string;
  dateOfBirth: Date | string;
  avatarUrl?: string | null;
  gender?: string | null;
  childProfile?: {
    level: number;
    totalXp: number;
    totalPoints: number;
    currentStreak: number;
  };
}

/** `yyyy-mm-dd` for "exactly N years ago today", which is what a date input's min/max wants. */
function dobBound(yearsAgo: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().split('T')[0];
}

export default function ParentChildrenPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [children, setChildren] = useState<Child[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [resetPinChild, setResetPinChild] = useState<Child | null>(null);

  useEffect(() => {
    loadChildren();
  }, []);

  const loadChildren = async () => {
    try {
      const response = await familyApi.getMembers();
      const members = (response.data as { members: Child[] }).members || [];
      setChildren(members.filter((m: Child & { role?: string }) => m.role === 'child'));
    } catch {
      showError('Failed to load children');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this child?')) return;

    try {
      await familyApi.removeChild(id);
      showSuccess('Child removed');
      loadChildren();
    } catch {
      showError('Failed to remove child');
    }
  };

    useDataRefresh(loadChildren);

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-slate-900">Children</h1>
            <p className="text-slate-600 mt-1">Manage your family members</p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4" />
            Add Child
          </Button>
        </div>

        {/* Children List */}
        {children.length === 0 ? (
          <div className="bg-white rounded-xl p-12 border-2 border-dashed border-slate-200 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="font-bold text-slate-900 mb-2">No children yet</h3>
            <p className="text-slate-600 mb-4">
              Add your first child to start assigning tasks and rewards
            </p>
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4" />
              Add Your First Child
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {children.map((child) => (
              <ChildCard
                key={child.id}
                child={child}
                onEdit={() => setEditingChild(child)}
                onDelete={() => handleDelete(child.id)}
                onResetPin={() => setResetPinChild(child)}
              />
            ))}
          </div>
        )}

        {/* Add/Edit Modal */}
        {(showAddModal || editingChild) && (
          <ChildModal
            child={editingChild}
            onClose={() => {
              setShowAddModal(false);
              setEditingChild(null);
            }}
            onSuccess={() => {
              setShowAddModal(false);
              setEditingChild(null);
              loadChildren();
            }}
          />
        )}

        {/* Reset PIN Modal */}
        {resetPinChild && (
          <ResetPinModal
            childId={resetPinChild.id}
            childName={resetPinChild.firstName}
            onClose={() => setResetPinChild(null)}
          />
        )}
      </div>
    </ParentLayout>
  );
}

// Child Card Component
function ChildCard({
  child,
  onEdit,
  onDelete,
  onResetPin,
}: {
  child: Child;
  onEdit: () => void;
  onDelete: () => void;
  onResetPin: () => void;
}) {
  const profile = child.childProfile;

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold text-xl overflow-hidden">
            {child.avatarUrl ? (
              <img src={child.avatarUrl} alt={child.firstName} className="w-full h-full object-cover" />
            ) : (
              getInitials(child.firstName, child.lastName)
            )}
          </div>
          <div>
            <h3 className="font-bold text-slate-900">
              {child.firstName} {child.lastName}
            </h3>
            {child.username && (
              <p className="text-sm text-slate-500">@{child.username}</p>
            )}
            {child.gender && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize mt-0.5">
                {child.gender}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit}>
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>

      {profile && (
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <div className="bg-xp-50 rounded-lg p-2">
            <div className="flex items-center justify-center gap-1 text-xp-600">
              <Trophy className="w-4 h-4" />
              <span className="font-bold">{profile.level}</span>
            </div>
            <p className="text-xs text-slate-500">Level</p>
          </div>
          <div className="bg-gold-50 rounded-lg p-2">
            <div className="flex items-center justify-center gap-1 text-gold-600">
              <Star className="w-4 h-4" />
              <span className="font-bold">{formatPoints(profile.totalPoints)}</span>
            </div>
            <p className="text-xs text-slate-500">Points</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-2">
            <div className="text-orange-600 font-bold">
              {profile.currentStreak > 0 ? `🔥 ${profile.currentStreak}` : '-'}
            </div>
            <p className="text-xs text-slate-500">Streak</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Key className="w-4 h-4" />
        <span>PIN: ••••</span>
        <Button variant="ghost" size="sm" className="ml-auto text-primary-600" onClick={onResetPin}>
          Reset PIN
        </Button>
      </div>
    </motion.div>
  );
}

// Add/Edit Child Modal
function ChildModal({
  child,
  onClose,
  onSuccess,
}: {
  child: Child | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: child?.firstName || '',
    lastName: child?.lastName || '',
    username: child?.username || '',
    dateOfBirth: child?.dateOfBirth ? String(child.dateOfBirth).split('T')[0] : '',
    pin: '',
    avatarUrl: child?.avatarUrl || '',
    email: '',
    gender: child?.gender || '',
  });

  /**
   * The consent tick. Deliberately NOT part of `formData`: it is not a property of the child, it is
   * a statement the adult makes at this moment, and it must never be prefilled from an existing
   * record when the form reopens to edit.
   */
  const [consentAccepted, setConsentAccepted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (child) {
        await familyApi.updateChild(child.id, {
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username.trim().toLowerCase(),
          avatarUrl: formData.avatarUrl || undefined,
          gender: formData.gender || undefined,
        });
        showSuccess('Child updated');
      } else {
        // Validate child age 10-16
        if (!formData.dateOfBirth) { showError('Date of birth is required'); setIsLoading(false); return; }
        const birth = new Date(formData.dateOfBirth);
        if (!isAgeBetween(formData.dateOfBirth, AGE_LIMITS.CHILD_MIN, AGE_LIMITS.CHILD_MAX)) {
          showError(`Child must be between ${AGE_LIMITS.CHILD_MIN} and ${AGE_LIMITS.CHILD_MAX} years old`);
          setIsLoading(false);
          return;
        }
        await familyApi.addChild({
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username.trim().toLowerCase(),
          dateOfBirth: formData.dateOfBirth,
          pin: formData.pin || undefined,
          email: formData.email || undefined,
          gender: formData.gender || undefined,
          consentFormAccepted: true,
        });
        showSuccess('Child added');
      }
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : (child ? 'Failed to update child' : 'Failed to add child');
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center overflow-y-auto z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl my-auto"
      >
        <h2 className="font-display text-xl font-bold text-slate-900 mb-6">
          {child ? 'Edit Child' : 'Add New Child'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {child && (
            <div className="flex justify-center">
              <AvatarUpload
                currentUrl={formData.avatarUrl}
                initials={getInitials(formData.firstName || child.firstName, formData.lastName || child.lastName)}
                size="lg"
                onUpload={(url) => setFormData((f) => ({ ...f, avatarUrl: url }))}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              required
            />
            <Input
              label="Last Name"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              required
            />
          </div>

          <Input
            label="Username"
            placeholder="What your child types to log in"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            title="3-20 characters: letters, numbers or underscores"
            required
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Gender <span className="text-slate-400">(optional)</span>
            </label>
            <select
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-700 bg-white"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
            >
              <option value="">Not specified</option>
              <option value="boy">Boy</option>
              <option value="girl">Girl</option>
            </select>
          </div>

          {!child && (
            <>
              <Input
                label="Email address (optional)"
                type="email"
                placeholder="Child's email for notifications"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
              <p className="text-sm text-slate-500 -mt-2">
                If provided, the child will receive a welcome email with their login details.
              </p>
            </>
          )}

          {!child && (
            <>
              <Input
                label="Date of Birth (age 10-16)"
                type="date"
                value={formData.dateOfBirth}
                max={dobBound(AGE_LIMITS.CHILD_MIN)}
                min={dobBound(AGE_LIMITS.CHILD_MAX + 1)}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                required
              />

              <Input
                label="PIN (4 digits)"
                type="password"
                placeholder="For child login"
                maxLength={4}
                value={formData.pin}
                onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              />
              <p className="text-sm text-slate-500">
                Your child will use this 4-digit PIN to log in on shared devices
              </p>
            </>
          )}

          {/* Adding only. Editing a child does not re-collect consent — it was given once, for this
              child, and re-asking would imply the earlier record had lapsed. */}
          {!child && (
            <label className="flex gap-3 items-start pt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 accent-primary-600"
                aria-describedby="consent-help"
              />
              <span id="consent-help" className="text-sm text-slate-600">
                I confirm I am this child&apos;s parent or legal guardian and I consent to TaskBuddy
                holding their information. A confirmation email recording this consent will be sent
                to everyone on this account.
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={isLoading} disabled={!child && !consentAccepted}>
              {child ? 'Save Changes' : 'Add Child'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

'use client';

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
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { getInitials, formatPoints } from '@/lib/utils';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  username?: string;
  dateOfBirth: string;
  childProfile?: {
    level: number;
    totalXp: number;
    totalPoints: number;
    currentStreak: number;
  };
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
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold text-xl">
            {getInitials(child.firstName, child.lastName)}
          </div>
          <div>
            <h3 className="font-bold text-slate-900">
              {child.firstName} {child.lastName}
            </h3>
            {child.username && (
              <p className="text-sm text-slate-500">@{child.username}</p>
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
    dateOfBirth: child?.dateOfBirth?.split('T')[0] || '',
    pin: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (child) {
        await familyApi.updateChild(child.id, {
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username || undefined,
        });
        showSuccess('Child updated');
      } else {
        await familyApi.addChild({
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username || undefined,
          dateOfBirth: formData.dateOfBirth,
          pin: formData.pin || undefined,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
      >
        <h2 className="font-display text-xl font-bold text-slate-900 mb-6">
          {child ? 'Edit Child' : 'Add New Child'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            label="Username (optional)"
            placeholder="For child login"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          />

          {!child && (
            <>
              <Input
                label="Date of Birth"
                type="date"
                value={formData.dateOfBirth}
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

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={isLoading}>
              {child ? 'Save Changes' : 'Add Child'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

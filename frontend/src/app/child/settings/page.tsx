'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, X } from 'lucide-react';
import { AVATAR_EMOJIS } from '@taskbuddy/shared';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { AvatarUpload } from '@/components/AvatarUpload';
import { familyApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

/**
 * FR-10 — child settings: pick your own avatar emoji.
 *
 * The picker offers a fixed allow-list (shared with the backend validator via AVATAR_EMOJIS) rather
 * than free text: this field is child-controlled and visible to the whole family, so free input
 * would be a user-generated-content surface on an app for 10-16 year olds.
 */
/**
 * The child profile arrives under two different keys depending on how the session was established:
 * the login response nests it as `profile`, GET /auth/me returns it as `childProfile`. Read both so
 * this page behaves the same on a fresh login and after a refreshUser().
 */
function readChildProfile(user: unknown): { avatarEmoji?: string; pendingAvatarUrl?: string | null } {
  const u = user as { profile?: Record<string, unknown>; childProfile?: Record<string, unknown> } | null;
  return (u?.profile ?? u?.childProfile ?? {}) as { avatarEmoji?: string; pendingAvatarUrl?: string | null };
}

export default function ChildSettingsPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const approvedPhoto = (user as { avatarUrl?: string | null } | null)?.avatarUrl ?? null;
  const initials = user ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}` : '?';

  useEffect(() => {
    const profile = readChildProfile(user);
    setSelected(profile.avatarEmoji ?? null);
    setPendingPhoto(profile.pendingAvatarUrl ?? null);
  }, [user]);

  const submitPhoto = async (url: string) => {
    setPhotoBusy(true);
    try {
      await familyApi.setMyAvatarPhoto(url);
      setPendingPhoto(url);
      toast.success('Sent to your parent to check!');
    } catch {
      toast.error('Could not send your photo. Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const cancelPhoto = async () => {
    setPhotoBusy(true);
    try {
      await familyApi.setMyAvatarPhoto(null);
      setPendingPhoto(null);
      toast.success('Photo cancelled');
    } catch {
      toast.error('Could not cancel. Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const choose = async (emoji: string) => {
    const next = selected === emoji ? null : emoji; // tapping the current one clears it
    setSaving(emoji);
    const previous = selected;
    setSelected(next); // optimistic

    try {
      await familyApi.setMyAvatarEmoji(next);
      await refreshUser();
      toast.success(next ? 'Avatar updated!' : 'Avatar cleared');
    } catch {
      setSelected(previous); // roll the optimistic update back
      toast.error('Could not save your avatar. Try again.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <ChildLayout>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">My Settings</h1>
          <p className="text-sm opacity-70">Choose an avatar that shows up next to your name.</p>
        </header>

        <section aria-labelledby="photo-heading" className="space-y-3">
          <h2 id="photo-heading" className="font-semibold">
            Your photo
          </h2>

          <div className="flex items-center gap-4">
            <div className="relative">
              <AvatarUpload
                currentUrl={pendingPhoto ?? approvedPhoto}
                initials={initials}
                size="lg"
                onUpload={submitPhoto}
              />
              {pendingPhoto && (
                <span
                  className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 p-1 text-white"
                  aria-hidden="true"
                >
                  <Clock className="h-4 w-4" />
                </span>
              )}
            </div>

            <div className="min-w-0 space-y-2">
              {pendingPhoto ? (
                <>
                  <p className="text-sm font-medium text-amber-600">
                    Waiting for a parent to say yes
                  </p>
                  <p className="text-xs opacity-70">
                    Nobody else can see it until then.
                  </p>
                  <button
                    type="button"
                    onClick={cancelPhoto}
                    disabled={photoBusy}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:bg-white/10"
                  >
                    <X className="h-3 w-3" />
                    Pick a different one
                  </button>
                </>
              ) : (
                <p className="text-sm opacity-70">
                  Tap the circle to choose a photo. A parent checks it first, then everyone in your
                  family can see it.
                </p>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="avatar-heading" className="space-y-3">
          <h2 id="avatar-heading" className="font-semibold">
            Pick your avatar
          </h2>

          <div className="grid grid-cols-6 gap-3 sm:grid-cols-8">
            {AVATAR_EMOJIS.map((emoji) => {
              const isSelected = selected === emoji;
              return (
                <motion.button
                  key={emoji}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => choose(emoji)}
                  disabled={saving !== null}
                  aria-pressed={isSelected}
                  aria-label={`Avatar ${emoji}`}
                  className={cn(
                    'relative flex aspect-square items-center justify-center rounded-xl text-2xl transition',
                    'border-2 disabled:opacity-50',
                    isSelected
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-transparent bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
                  )}
                >
                  {emoji}
                  {isSelected && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-purple-500 p-0.5 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          <p className="text-xs opacity-60">Tap your avatar again to remove it.</p>
        </section>
      </div>
    </ChildLayout>
  );
}

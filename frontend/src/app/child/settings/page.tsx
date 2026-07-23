'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { AVATAR_EMOJIS } from '@taskbuddy/shared';
import { ChildLayout } from '@/components/layouts/ChildLayout';
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
export default function ChildSettingsPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setSelected((user?.profile as { avatarEmoji?: string } | undefined)?.avatarEmoji ?? null);
  }, [user]);

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

/**
 * Raises an on-screen toast when a new notification arrives.
 *
 * Renders nothing. It exists because until push lands (P0-3, then Phase 4) there is **no
 * server→device channel**: nothing can wake the app, so the only way a phone learns that a parent
 * approved a task is to ask. `unreadCountQuery` polls once a minute and refetches on focus; this
 * watches the number and speaks when it grows.
 *
 * ## Growth only, never the absolute value
 *
 * The trigger is `count > previous`, and `previous` starts at whatever the first successful poll
 * returns. Toasting on "unread > 0" would fire on every cold start for a child who has simply not
 * opened the notifications screen in a week — an alert about nothing new, which teaches people to
 * ignore alerts. A *decrease* (reading them) is silent, as it should be.
 *
 * ## It says how many, not what
 *
 * The unread-count endpoint returns only a number, and fetching the list on every tick to name the
 * newest item would triple the polling cost against a 100-request budget. The toast is a prompt to
 * look, and the notifications screen is one tap away.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useToast } from '@/components/Toast';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { useAuth } from '@/stores/auth';

export function NotificationWatcher() {
  const status = useAuth((state) => state.status);
  const signedIn = status === 'signedIn';
  const toast = useToast();

  const { data } = useQuery({ ...unreadCountQuery(), enabled: signedIn });
  const count = data?.count;

  /**
   * `undefined` until the first poll lands, which is what makes the first observation a baseline
   * rather than an arrival. A ref, not state: updating it must not trigger a render, and the effect
   * below must compare against the value from the *previous* run.
   */
  const previous = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Signing out resets the baseline, so the next account's first poll is not read as a burst of
    // arrivals belonging to the person who just left.
    if (!signedIn) {
      previous.current = undefined;
      return;
    }
    if (count === undefined) return;

    const before = previous.current;
    previous.current = count;

    if (before === undefined || count <= before) return;

    const arrived = count - before;
    toast.show(
      arrived === 1 ? 'You have a new notification' : `You have ${plural(arrived, 'new notification')}`,
      'info'
    );
  }, [count, signedIn, toast]);

  return null;
}

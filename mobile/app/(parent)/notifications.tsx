/**
 * Parent notifications. Reached from the dashboard, not a tab — the parent shell already has five.
 * All the behaviour lives in the shared component; only the destination mapping differs by role.
 */
import { NotificationList } from '@/components/NotificationList';

export default function ParentNotifications() {
  return (
    <NotificationList role="parent" back={{ label: 'Back to Dashboard', href: '/(parent)/dashboard' }} />
  );
}

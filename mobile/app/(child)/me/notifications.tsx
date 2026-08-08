/**
 * Child notifications, under the Me tab alongside the other reference screens.
 */
import { NotificationList } from '@/components/NotificationList';

export default function ChildNotifications() {
  return <NotificationList role="child" back={{ label: 'Back to Me', href: '/(child)/me' }} />;
}

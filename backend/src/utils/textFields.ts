import { z } from 'zod';

/**
 * Text people type that is later shown to OTHER people: family names, first and last names.
 *
 * These reach email subjects and bodies, push notifications and other family members' screens.
 * HTML is escaped where it is rendered (emails/base.ts), so `<` and `>` stay legal here: rejecting them
 * would also refuse to save an existing row that happens to contain one. Control characters are
 * refused, because a line break in a name becomes a line break in an email header or a log line.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x1F\\x7F]');

export function displayText(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARS.test(value), { message: 'Must not contain line breaks or control characters' });
}

/**
 * An image URL that must point at our own storage (security audit 2026-09-14).
 *
 * Avatars are rendered in other people's browsers and phones. An arbitrary URL there is a tracking
 * beacon (every family member's IP and device, every time the dashboard loads) or unmoderated content
 * in a children's app. Every client uploads first and sends back the URL the upload returned, so this
 * refuses nothing a real screen does. The child-submitted path already had this check; the parent
 * paths did not.
 */
export function ownStorageUrl(isOwn: (url: string) => boolean) {
  return z.string().url().refine(isOwn, { message: 'That image must be uploaded through TaskBuddy.' });
}

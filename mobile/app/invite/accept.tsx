/**
 * `/invite/accept` — the address the co-parent invitation email actually points at.
 *
 * The screen itself is `app/accept-invite.tsx`; this file exists only because the two disagree.
 * `inviteService` builds the link as `<FRONTEND_URL>/invite/accept?token=…`, and an Android App Link
 * is matched on that literal path, so a route has to exist at it. Renaming `accept-invite.tsx` was
 * the alternative and is worse: it is reachable from inside the app too, where `/accept-invite`
 * reads correctly and `/invite/accept` would not.
 *
 * Re-exported rather than redirected on purpose. A `<Redirect>` would mount, navigate and remount,
 * which on a cold start from an email link shows a visible flash and, more importantly, risks
 * dropping the `token` query parameter in the hop. Re-exporting gives one screen at two addresses
 * with one implementation and no navigation at all.
 */
export { default } from '../accept-invite';

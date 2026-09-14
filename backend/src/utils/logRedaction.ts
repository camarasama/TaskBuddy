/**
 * Keep credentials out of access logs (security audit 2026-09-14).
 *
 * `GET /auth/invite-preview?token=...` carries a live co-parent invite token in the query string, and
 * morgan's `combined` format writes the full URL to journald. Anyone who can read the logs could
 * accept the invite before the invitee does. The GET stays (installed app builds call it); the log
 * line loses the value instead.
 */

const SECRET_PARAMS = ['token', 'code', 'refreshToken', 'mfaToken', 'password', 'pin'];
const PATTERN = new RegExp(`([?&](?:${SECRET_PARAMS.join('|')})=)[^&#\\s]*`, 'gi');

export function redactUrl(url: string): string {
  return url.replace(PATTERN, '$1[redacted]');
}

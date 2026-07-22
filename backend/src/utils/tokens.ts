import crypto from 'crypto';

/**
 * Hash a bearer token for storage. Email-verification and family-invite tokens live in the DB as
 * sha256 hex, not plaintext, so a leaked database snapshot cannot be used to verify emails or
 * accept invites. The raw token only ever exists in the link we email; lookups hash the presented
 * value and compare.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

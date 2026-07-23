import crypto from 'crypto';
import { authenticator } from 'otplib';
import { config } from '../config';

// F-9: admin TOTP (RFC 6238) with the shared secret encrypted at rest.
//
// The secret is stored as `iv:authTag:ciphertext` (all hex) under AES-256-GCM. The 32-byte key is
// derived from MFA_ENCRYPTION_KEY via SHA-256 so any-length env value works, while GCM's auth tag
// makes tampering with a stored secret detectable.

const ALGO = 'aes-256-gcm';

function encryptionKey(): Buffer {
  const raw = config.mfa.encryptionKey;
  if (!raw) throw new Error('MFA_ENCRYPTION_KEY is not set — admin MFA cannot be used.');
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed encrypted MFA secret');
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Fresh base32 TOTP secret for a new enrollment. */
export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI the authenticator app scans (rendered as a QR by the frontend). */
export function mfaKeyUri(accountName: string, secret: string): string {
  return authenticator.keyuri(accountName, 'TaskBuddy', secret);
}

/** Verify a 6-digit code against the secret (otplib allows a ±1 step window by default). */
export function verifyMfaCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code.trim(), secret });
  } catch {
    return false; // malformed input → treat as a failed attempt, never throw into the auth flow
  }
}

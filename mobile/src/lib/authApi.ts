/**
 * Auth endpoint wrappers (§3.3).
 *
 * Thin on purpose: everything about retrying, refreshing and error shaping lives in `api.ts`. What
 * this module adds is the two things that are genuinely specific to signing in — the token payload
 * shape mobile receives, and the fact that `/auth/login` has *two* possible successful outcomes.
 *
 * Every call here passes `session: false`. These endpoints establish or end a session, so a 401 from
 * them means "wrong password", not "the access token expired" — refreshing in response would be
 * nonsense, and on a rotating-token backend it would also be destructive.
 */
import { VALIDATION } from '@taskbuddy/shared';
import type { ChildLoginRequest, ChildProfile, LoginRequest, User } from '@taskbuddy/shared';

import { ApiError, api } from './api';
import { asDate } from './dates';
import { clearSession, getRefreshToken, setAccessToken, setRefreshToken } from './tokenStore';

/**
 * Tokens as a *native* client receives them.
 *
 * Shared's `AuthTokens` deliberately omits `refreshToken` because that is the web's contract — the
 * token reaches a browser only as an HttpOnly cookie (F-2). P0-1 added the native path, where it
 * arrives in the body instead, so mobile needs the wider shape. Declared here rather than widened in
 * shared, so the web's type keeps stating the guarantee that actually holds for the web.
 */
export interface MobileAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MobileLoginResponse {
  user: Omit<User, 'passwordHash'>;
  profile?: ChildProfile;
  tokens: MobileAuthTokens;
}

/**
 * `/auth/login` answers 200 in two different shapes.
 *
 * A parent or admin enrolled in MFA (F-9 for admins, FR-17 extended enrolment to parents) gets a
 * short-lived challenge token and **no session** — the password was right but login is not finished
 * until `POST /auth/mfa/challenge` receives a TOTP code. Treating this as a successful login would
 * leave the app convinced it is signed in with no tokens to show for it.
 */
export interface MfaChallengeRequired {
  mfaRequired: true;
  mfaToken: string;
}

type LoginResult = MobileLoginResponse | MfaChallengeRequired;

export function isMfaChallenge(result: LoginResult): result is MfaChallengeRequired {
  return 'mfaRequired' in result;
}

/**
 * Store a freshly-issued pair.
 *
 * Refresh token first, for the same reason the rotation path does it in that order: it is the
 * credential that cannot be re-derived, so it must be safely down before anything depends on the
 * session existing. Returns false if the keystore write failed, in which case the caller must not
 * report a successful login — the session would not survive the app closing.
 */
async function storeTokens(tokens: MobileAuthTokens): Promise<boolean> {
  const persisted = await setRefreshToken(tokens.refreshToken);
  if (!persisted) {
    await clearSession();
    return false;
  }
  setAccessToken(tokens.accessToken);
  return true;
}

/** Raised when sign-in succeeded but the credential could not be stored. */
export class CredentialStorageError extends Error {
  constructor() {
    super('Signed in, but this device could not store the session securely. Please try again.');
    this.name = 'CredentialStorageError';
  }
}

/**
 * Raised when valid credentials belong to an admin.
 *
 * Admin is web-only, permanently, by owner decision — the admin surface is not being built for mobile
 * at all. The server's role gates already refuse admin-only routes, so this is not a security control:
 * it exists so an admin who tries the app is told why, rather than being dropped into a shell with no
 * screens they can use.
 *
 * Lives here beside the other sign-in error so `lib/` does not have to depend on the store, even
 * though the policy is applied in `stores/auth.ts`.
 */
export class AdminNotSupportedError extends Error {
  constructor() {
    super('Admin accounts are available on the web only. Please sign in at gettaskbuddy.com.');
    this.name = 'AdminNotSupportedError';
  }
}

export async function login(credentials: LoginRequest): Promise<LoginResult> {
  const result = await api.post<LoginResult>('/auth/login', credentials, { session: false });

  // No tokens yet — the caller must complete the TOTP step.
  if (isMfaChallenge(result)) return result;

  if (!(await storeTokens(result.tokens))) throw new CredentialStorageError();
  return result;
}

/** Second leg of an MFA login: exchange the challenge token plus a TOTP code for a real session. */
export async function completeMfaChallenge(
  mfaToken: string,
  code: string
): Promise<MobileLoginResponse> {
  const result = await api.post<MobileLoginResponse>(
    '/auth/mfa/challenge',
    { mfaToken, code },
    { session: false }
  );

  if (!(await storeTokens(result.tokens))) throw new CredentialStorageError();
  return result;
}

/**
 * Child sign-in. `childIdentifier` is a username or first name, and `familyCode` is uppercased and
 * trimmed server-side, so the UI need not police either.
 *
 * QR onboarding (Phase 2) will supply `familyCode` from secure storage rather than from a field the
 * child types — the shape of this call does not change for it.
 */
export async function childLogin(credentials: ChildLoginRequest): Promise<MobileLoginResponse> {
  const result = await api.post<MobileLoginResponse>('/auth/child/login', credentials, {
    session: false,
  });

  if (!(await storeTokens(result.tokens))) throw new CredentialStorageError();
  return result;
}

export function fetchCurrentUser(signal?: AbortSignal): Promise<{ user: Omit<User, 'passwordHash'> }> {
  return api.get<{ user: Omit<User, 'passwordHash'> }>('/auth/me', { signal });
}

/**
 * Sign out.
 *
 * The local half runs whatever the server says. A failed request must still end the session on the
 * device — otherwise "sign out" on a train leaves the user signed in, which is the one outcome a
 * sign-out button may never produce. The server call is what revokes the refresh chain, so it is
 * attempted first and its failure is swallowed deliberately.
 */
export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  try {
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }, { session: false });
    }
  } catch {
    // Offline, or the token was already dead. Either way the local clear below is what matters.
  } finally {
    await clearSession();
  }
}

// ─── Mirrors of the server's Zod rules (U4) ──────────────────────────────────
//
// These live here, beside the calls they guard, so `register.tsx` and `accept-invite.tsx` cannot
// drift apart from each other or from `backend/src/routes/auth.ts`. They are a courtesy to the user
// — an inline message instead of a round trip — and never the only check: the server validates
// independently and its answer is what the screens report on submit.

/**
 * Minimum length for a password being *set* (register, reset, accept-invite).
 *
 * **Not 8.** `VALIDATION.PASSWORD.MIN_LENGTH` is the legacy floor that existing passwords and
 * `/auth/login` are held to; every route that mints a new one uses `NEW_MIN_LENGTH` (F-10). The web's
 * register/reset/invite pages still say 8, which means they show a rule the API will reject —
 * do not "fix" mobile to match them.
 */
export const NEW_PASSWORD_MIN_LENGTH = VALIDATION.PASSWORD.NEW_MIN_LENGTH;

/** The server accepts a date of birth in this shape only; anything else is a 400. */
export const DATE_OF_BIRTH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** E.164, e.g. `+233201234567`. Same expression the register schema uses. */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Both schemas require a parent to be at least this old. */
export const MIN_PARENT_AGE_YEARS = 18;

/**
 * The `.refine()` on both `registerSchema` and `acceptInviteSchema`, restated.
 *
 * Compares against a cutoff built by subtracting the years from today, exactly as the server does,
 * rather than computing an age — subtracting calendar years is the only version that gets a birthday
 * on 29 February right without special-casing it.
 */
export function isAdultDateOfBirth(dateOfBirth: string, now = new Date()): boolean {
  if (!DATE_OF_BIRTH_PATTERN.test(dateOfBirth)) return false;
  const birth = asDate(dateOfBirth);
  if (!birth) return false;
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - MIN_PARENT_AGE_YEARS);
  return birth <= cutoff;
}

/**
 * Per-field validation messages from a failed request, keyed by the **last** path segment.
 *
 * The backend reports Zod paths joined with dots, so `/auth/register` — whose schema nests the
 * person under `parent` — says `parent.email` where the form has a field called `email`. Keying on
 * the last segment lets one map serve the nested register payload and the flat accept-invite one
 * without either screen knowing which shape it sent.
 *
 * First message per field wins; a field with two failures has one worth showing and one that
 * repeats it. Returns an empty map for anything that is not an `ApiError`, so callers can call it
 * unconditionally and fall back to `describeError`.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};

  const messages: Record<string, string> = {};
  for (const detail of error.details) {
    const key = detail.field.split('.').pop();
    if (key && !(key in messages)) messages[key] = detail.message;
  }
  return messages;
}

/**
 * Pull the token out of whatever the user pasted.
 *
 * Needed because **the emails link to the website, not the app.** `FRONTEND_URL` is what
 * `/auth/register`, `/auth/forgot-password` and `InviteService` build their links from, and no
 * Android App Link is registered for gettaskbuddy.com, so a tester on a phone arrives at these
 * screens by pasting rather than by tapping. Accepting the whole URL as well as a bare token is the
 * difference between "paste the link" and "open the link, find the bit after token=, copy that".
 *
 * Deliberately tolerant: anything with a `token=` parameter yields that parameter, anything else is
 * treated as the token itself and trimmed. A wrong guess costs a readable "invalid link" from the
 * server, which is the same thing a wrong token costs.
 */
export function extractToken(pasted: string): string {
  const trimmed = pasted.trim();
  const match = /[?&]token=([^&#\s]+)/.exec(trimmed);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      // A stray `%` in a pasted string makes decodeURIComponent throw. The raw value is still the
      // best available guess, and the server will say so if it is wrong.
      return match[1];
    }
  }
  return trimmed;
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * The register form's fields, flat.
 *
 * The endpoint wants them nested (`{ familyName, parent: { … } }`); `register()` below does that
 * reshaping so no screen has to remember it. Field names otherwise match the server's exactly —
 * note `phoneNumber` here, against `phone` on accept-invite. That inconsistency is the backend's and
 * is not worth papering over: the two names are what the two schemas actually accept.
 */
export interface RegisterInput {
  familyName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /** YYYY-MM-DD. **Required** — the server's schema has no `.optional()` on it. */
  dateOfBirth: string;
  /** E.164. Optional; send `undefined`, never an empty string, which fails the regex. */
  phoneNumber?: string;
  gender?: 'male' | 'female';
}

/**
 * `family` is narrowed to the fields the app reads. Shared's `Family` model has no `familyCode`
 * despite the API returning one, and its `createdAt`/`updatedAt` are typed `Date` while JSON
 * delivers strings — see `dates.ts`. Stating only what is used avoids inheriting both problems.
 */
export interface MobileRegisterResponse {
  user: Omit<User, 'passwordHash'>;
  family: { id: string; familyName: string; familyCode: string };
  tokens: MobileAuthTokens;
}

/**
 * Create a family and its first parent. **Signs the device in on success.**
 *
 * Unlike `/auth/login` this has exactly one success shape: the route always mints tokens, and the
 * account it just created cannot be MFA-enrolled, so there is no challenge branch to handle. If
 * registration ever grows one, mirror `login()` above rather than adding a second convention.
 *
 * The new account's email is unverified at this point. That is deliberate on the backend — nothing
 * is gated on verification — so the screen signs in and mentions the email rather than blocking.
 */
export async function register(input: RegisterInput): Promise<MobileRegisterResponse> {
  const { familyName, phoneNumber, gender, ...parent } = input;

  const result = await api.post<MobileRegisterResponse>(
    '/auth/register',
    {
      familyName,
      parent: {
        ...parent,
        // Omitted rather than blank: `''` fails the E.164 regex and the gender enum, so sending an
        // untouched optional field would 400 a perfectly good form.
        phoneNumber: phoneNumber || undefined,
        gender: gender || undefined,
      },
    },
    { session: false }
  );

  if (!(await storeTokens(result.tokens))) throw new CredentialStorageError();
  return result;
}

// ─── Password reset ──────────────────────────────────────────────────────────

/**
 * Ask for a reset link.
 *
 * **Always answers 200**, whether or not the address maps to an account, and the same way when the
 * per-email rate limit is hit — that is anti-enumeration, not a bug, and the screen must not try to
 * infer anything from a success. The only failures that reach the caller are transport errors and
 * the global 429, neither of which says anything about whether an account exists.
 */
export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/forgot-password', { email }, { session: false });
}

/** Complete a reset. The token comes from the emailed link; it is consumed on success. */
export function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(
    '/auth/reset-password',
    { token, newPassword },
    { session: false }
  );
}

// ─── Email verification ──────────────────────────────────────────────────────

/**
 * Consume a verification token.
 *
 * Answers 200 with "Email already verified" for a token that was used once and re-presented, but
 * 404 for an unknown one and 409 for an expired one — so a failure here is worth distinguishing in
 * the UI, and is not always the user's fault.
 */
export function verifyEmail(token: string): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/verify-email', { token }, { session: false });
}

/**
 * Send a fresh verification link.
 *
 * `session: false` so no `Authorization` header goes out. The endpoint reads one when present, but
 * the screen that calls this is reachable while signed out — and passing a *stale* access token
 * would make the server look the user up from the token and silently ignore the address typed into
 * the form. Three per hour per address, server-side.
 */
export function resendVerification(email: string): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/resend-verification', { email }, { session: false });
}

// ─── Co-parent invitations ───────────────────────────────────────────────────

/** What the accept screen can show before asking for anything. Public — no session required. */
export interface InvitePreview {
  familyName: string;
  inviterName: string;
  /** The address the invitation was sent to. Fixed: the invitee cannot choose a different one. */
  email: string;
  /** ISO string, despite the service typing it `Date`. Run it through `asDate`. */
  expiresAt: string;
}

/**
 * Look up an invitation.
 *
 * 404s — with a message written for a human — for a token that is unknown, already accepted or
 * expired. That is the whole error surface, and each case is worth showing verbatim.
 */
export function fetchInvitePreview(token: string, signal?: AbortSignal): Promise<InvitePreview> {
  return api.get<InvitePreview>(`/auth/invite-preview?token=${encodeURIComponent(token)}`, {
    signal,
    session: false,
  });
}

/**
 * The accept-invite payload. Note `phone`, not `phoneNumber` — and `dateOfBirth` optional here
 * where register requires it. Both differences are the server's schema, verified against
 * `acceptInviteSchema` in `backend/src/routes/auth.ts`.
 *
 * There is no `email`: the address is whatever the invitation was issued to, and the server takes it
 * from the invitation record. Offering a field for it would imply a choice that does not exist.
 */
export interface AcceptInviteInput {
  token: string;
  firstName: string;
  lastName: string;
  password: string;
  dateOfBirth?: string;
  phone?: string;
  gender?: 'male' | 'female';
}

export interface MobileAcceptInviteResponse {
  user: Omit<User, 'passwordHash'>;
  family: { id: string; familyName: string };
  tokens: MobileAuthTokens;
}

/**
 * Join a family as a co-parent. **Signs the device in on success.**
 *
 * The account is created with `emailVerifiedAt` already set — accepting the emailed link is itself
 * proof of the address — so there is no verification step after this.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<MobileAcceptInviteResponse> {
  const result = await api.post<MobileAcceptInviteResponse>(
    '/auth/accept-invite',
    {
      ...input,
      dateOfBirth: input.dateOfBirth || undefined,
      phone: input.phone || undefined,
      gender: input.gender || undefined,
    },
    { session: false }
  );

  if (!(await storeTokens(result.tokens))) throw new CredentialStorageError();
  return result;
}

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
import type { ChildLoginRequest, ChildProfile, LoginRequest, User } from '@taskbuddy/shared';

import { api } from './api';
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

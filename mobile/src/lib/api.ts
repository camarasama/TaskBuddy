/**
 * The API client (§3.2).
 *
 * Ported from `frontend/src/lib/api.ts` deliberately rather than copied — the differences are not
 * incidental:
 *
 *   - **Absolute base URL.** The web's `/api/v1` default is a same-origin relative path and means
 *     nothing on a phone. It comes from `app.config.ts` via `config.ts`.
 *   - **No `credentials: 'include'`.** React Native has no dependable cookie jar; that is the whole
 *     reason P0-1 exists. The refresh token travels in the request *body*, from the keystore.
 *   - **No CSRF.** The web needs it because `/auth/refresh` there authenticates from an *ambient*
 *     cookie. A body-supplied credential is explicit, so it is not a CSRF vector, and
 *     `backend/src/middleware/csrf.ts` already skips the check when no refresh cookie is present.
 *   - **No GET cache.** The web hand-rolls a 30s stale-while-revalidate map; React Query owns
 *     caching here, and two caching layers would fight over invalidation.
 *   - **Refresh, then retry once.** The web recurses into `request()` after a refresh, which can
 *     loop. This retries exactly once and then gives up.
 *   - **No navigation.** The web does `window.location.href = '/login'`. This module has no router
 *     and should not grow one; it publishes session expiry through `onSessionExpired` and lets the
 *     navigation layer decide.
 *
 * ## Why the refresh is single-flight, which is the load-bearing detail
 *
 * The backend **rotates** refresh tokens: `/auth/refresh` mints a new one and marks the presented
 * one spent (`SessionService.rotate`). Presenting a spent token — or merely losing the conditional
 * update race against a concurrent rotation — revokes the **entire chain** and writes a
 * `SESSION_REUSE` audit event. It cannot tell an honest race from a replayed stolen token, and it is
 * right not to try.
 *
 * So if two requests 401 at the same moment and each refreshes with the same stored token, one wins
 * and the other burns the session: the user is signed out of the device and a security event is
 * logged. That is not a rare interleaving — it is what a dashboard mount looks like, several
 * parallel queries hitting an access token that expired while the app was backgrounded.
 *
 * Hence exactly one refresh may ever be in flight, and every concurrent 401 awaits that same
 * promise. Everything else here is ordinary; this part is not optional.
 */
import { API_URL, CLIENT_HEADER } from './config';
import { reportError } from './reporting';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './tokenStore';

/** Every backend route answers with this envelope; see backend/src/middleware/errorHandler.ts. */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: { field: string; message: string }[];
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable code where the backend sets one, e.g. `EMAIL_NOT_VERIFIED`. */
    readonly code?: string,
    /** Per-field validation failures, for wiring straight into a form. */
    readonly details: { field: string; message: string }[] = [],
    /**
     * Seconds until the rate-limit window rolls, from the `Retry-After` header. Only set on a 429.
     *
     * Present so the UI can say how long rather than "try again later", and so retry logic has
     * something better than a guess. See `isRateLimited` below.
     */
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A 429 from the rate limiter.
 *
 * Worth its own predicate because the correct response is the opposite of every other failure:
 * **do not retry.** The backend's global limiter is 100 requests per 15 minutes keyed on **IP**
 * (`backend/src/index.ts`), so a retry does not just fail again — it spends another request from an
 * already-empty bucket and pushes the window out for every other device behind the same address.
 * A family behind one router, or any number of customers behind carrier NAT, share that bucket.
 * (Keying it on the account instead is backend item P0-5, still outstanding.)
 *
 * Returns a plain boolean rather than a type predicate on purpose: callers use it *inside* an
 * `instanceof ApiError` branch, and a predicate would narrow the negative branch to `never` and break
 * the ordinary error handling that follows.
 */
export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

/**
 * A request that failed before reaching the server — no signal, airplane mode, DNS, the VPS down.
 * Distinguished from ApiError because the user-facing advice differs: "check your connection"
 * versus "something went wrong on our end".
 */
export class NetworkError extends Error {
  constructor(readonly cause: unknown) {
    super('Could not reach TaskBuddy. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

/**
 * The session is genuinely over and the user must sign in again — the server rejected the refresh
 * token, not merely "the request failed". Never thrown for a transport failure; see
 * `RefreshOutcome`.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

// ─── Session-expiry notification ─────────────────────────────────────────────

type SessionExpiredListener = () => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Subscribe to session expiry. Returns an unsubscribe function.
 *
 * The navigation layer uses this to send the user to the login screen. Kept as a subscription rather
 * than an import of the router because a module that both performs fetches and drives navigation
 * cannot be tested without mounting one, and because expiry can surface from a background query
 * where no screen is in scope.
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) {
    // One bad listener must not stop the others, nor bubble out of a fetch.
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/**
 * Why this is three states and not a boolean.
 *
 * `offline` must not log anyone out. A refresh that never reached the server says nothing about
 * whether the session is valid, and discarding a 90-day credential because a tunnel died would be a
 * self-inflicted logout — on a phone, on a train, which is exactly where this app runs.
 */
type RefreshOutcome = 'refreshed' | 'expired' | 'offline';

/** Diagnostics for the failure modes worth seeing in Sentry rather than inferring from a logout. */
export const REFRESH_ERRORS: string[] = [];

/**
 * Every one of these describes a session ending for a reason the user cannot see, so it goes to the
 * reporting seam as well as the local array — otherwise the only symptom is an unexplained sign-out.
 */
function recordRefreshFailure(message: string): void {
  REFRESH_ERRORS.push(message);
  reportError(new Error(message), 'api.refresh');
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Refresh the access token, coalescing concurrent callers onto one request.
 *
 * Exported because the auth bootstrap calls it directly on launch to turn a stored refresh token
 * back into a live session.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(): Promise<RefreshOutcome> {
  const stored = await getRefreshToken();
  if (!stored) {
    setAccessToken(null);
    return 'expired';
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Client': CLIENT_HEADER,
      },
      body: JSON.stringify({ refreshToken: stored }),
    });
  } catch {
    // Never reached the server, so the stored token is still presumed good. Keep it.
    return 'offline';
  }

  if (!response.ok) {
    // An explicit rejection. The token is spent, forged, past its absolute cap, or the chain was
    // revoked. All of them mean the same thing to us and none of them are recoverable.
    await clearSession();
    notifySessionExpired();
    return 'expired';
  }

  let tokens: { accessToken?: string; refreshToken?: string } | undefined;
  try {
    const body = (await response.json()) as ApiEnvelope<{
      tokens?: { accessToken?: string; refreshToken?: string };
    }>;
    tokens = body?.data?.tokens;
  } catch {
    recordRefreshFailure('refresh returned 200 with an unparseable body');
  }

  if (!tokens?.accessToken) {
    recordRefreshFailure('refresh returned 200 without an access token');
    await clearSession();
    notifySessionExpired();
    return 'expired';
  }

  /**
   * A 200 with no `refreshToken` means the backend did not recognise us as a native client and set
   * a cookie instead — i.e. `X-Client` is malformed (`config.test.ts` guards the header for exactly
   * this reason). It looks harmless: the access token works and the app carries on for another
   * fifteen minutes. But the server has already spent our stored token, so the *next* refresh
   * presents a dead one, burns the chain and logs a SESSION_REUSE event.
   *
   * Failing here instead turns a confusing security-flavoured logout twenty minutes from now into
   * one obvious sign-out with a diagnostic attached.
   */
  if (!tokens.refreshToken) {
    recordRefreshFailure(
      'refresh returned 200 without a refresh token — X-Client was not recognised as native, ' +
        'so the rotated token went to a cookie this client cannot read'
    );
    await clearSession();
    notifySessionExpired();
    return 'expired';
  }

  // Persist the rotated token BEFORE putting the new access token into play. The server has already
  // spent the old one; if this write is lost, the live credential exists nowhere and the next launch
  // is an unexplained logout. Ending the session deliberately is the better failure.
  const persisted = await setRefreshToken(tokens.refreshToken);
  if (!persisted) {
    recordRefreshFailure('could not persist the rotated refresh token — keystore write failed');
    await clearSession();
    notifySessionExpired();
    return 'expired';
  }

  setAccessToken(tokens.accessToken);
  return 'refreshed';
}

// ─── Requests ────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Serialised as JSON. Omit for GET/DELETE. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Whether this call participates in the session — sends `Authorization` and may refresh-then-retry
   * on a 401. Set false for the endpoints that establish or end a session: a 401 from `/auth/login`
   * means "wrong password", and refreshing in response to it would be nonsense.
   */
  session?: boolean;
  /**
   * Return the parsed body as-is instead of unwrapping `{ success, data }`.
   *
   * **`/notifications/*` is the one part of the API that does not use the envelope.** Its handlers
   * answer with bare objects — `{ notifications, unreadCount, total, pagination }`,
   * `{ count }`, `{ notification, unreadCount }` — and the web client reads them directly. Through
   * the normal path those responses **throw on a 200**, because the envelope check below treats a
   * missing `success` as a failure. That is not a hypothetical: it is why the notifications feature
   * could not be built on mobile at all until this option existed.
   *
   * Deliberately an opt-in per call rather than a loosening of the envelope check. Making
   * `success` optional would silently accept a malformed response from every other route, which is
   * exactly the class of bug the check is there to catch. Normalising the backend instead would
   * break the web, which already reads these bare.
   *
   * A raw call still gets the full session treatment — auth header, 401 refresh-and-retry, rate-limit
   * handling — and still throws `ApiError` on a non-2xx. Only the unwrapping changes.
   */
  raw?: boolean;
}

/**
 * Seconds from the `Retry-After` header, when the server sent one.
 *
 * The rate limiter sets it alongside the 429 (`standardHeaders: true`), and it is the only honest
 * answer to "how long?" — anything the client guesses would be a made-up number in a message that
 * looks authoritative.
 */
function retryAfter(response: Response): number | undefined {
  const raw = response.headers?.get?.('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, signal, session = true } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client': CLIENT_HEADER,
  };
  /**
   * `FormData` bodies are passed through untouched and **must not** carry a Content-Type.
   *
   * A multipart request needs a boundary parameter in that header, and only the fetch
   * implementation knows the boundary it generated. Setting `multipart/form-data` by hand — or
   * leaving the JSON default here — produces a request the server cannot parse, and multer answers
   * with a confusing "no file uploaded" rather than a content-type error. `JSON.stringify` on a
   * FormData would likewise yield `{}` and silently upload nothing.
   */
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json';

  const token = session ? getAccessToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isMultipart ? (body as FormData) : JSON.stringify(body),
      signal,
      // No `credentials` — see the note at the top of this file.
    });
  } catch (cause) {
    // fetch rejects only on transport failure; any HTTP status resolves. An aborted request lands
    // here too, and must stay an abort rather than becoming a "check your connection" message.
    if (signal?.aborted) throw cause;
    throw new NetworkError(cause);
  }

  /**
   * A 401 on a session request: the access token has expired. Refresh once, then replay.
   *
   * `isRetry` is what bounds this. Without it a server that answers 401 to a perfectly fresh token
   * would spin, and each spin would rotate the refresh token again.
   */
  if (response.status === 401 && session && !isRetry) {
    const outcome = await refreshSession();
    if (outcome === 'refreshed') return request<T>(path, options, true);
    // `expired` already cleared the session and notified listeners inside performRefresh.
    if (outcome === 'expired') throw new SessionExpiredError();
    throw new NetworkError(new Error('Could not reach the server to renew the session'));
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A non-JSON body means something upstream answered instead of the API — a proxy error page, a
    // captive portal. Fall through to the status-based message rather than crashing on parse.
  }

  // Raw callers are judged on the HTTP status alone — there is no envelope to consult. The error
  // shape is still read opportunistically, since a failure from these routes may carry one.
  if (options.raw) {
    if (!response.ok) {
      const error = (envelope as ApiEnvelope<T> | null)?.error;
      throw new ApiError(
        error?.message ?? `Request failed (${response.status})`,
        response.status,
        error?.code,
        error?.details ?? [],
        retryAfter(response)
      );
    }
    return envelope as unknown as T;
  }

  if (!response.ok || !envelope?.success) {
    const error = envelope?.error;
    const details = error?.details ?? [];
    // Field errors are far more useful than the generic parent message when a form is involved.
    const message = details.length
      ? details.map((d) => `${d.field}: ${d.message}`).join('; ')
      : (error?.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, error?.code, details, retryAfter(response));
  }

  return envelope.data as T;
}

/**
 * Verb helpers. These return the *unwrapped* `data` payload, unlike the web client, whose callers
 * each reach through the envelope themselves.
 */
export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

// ─── Public endpoints ────────────────────────────────────────────────────────

/** P0-2 — the version gate. Public, and callable before the app has a session. */
export interface MinVersionResponse {
  platforms: Record<string, string>;
  client: { platform: string; version: string } | null;
  upgradeRequired: boolean;
}

export function fetchMinVersion(signal?: AbortSignal): Promise<MinVersionResponse> {
  return api.get<MinVersionResponse>('/meta/min-version', { signal, session: false });
}

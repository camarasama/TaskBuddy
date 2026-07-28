/**
 * Minimal API client — the scaffold seed.
 *
 * Deliberately unauthenticated for now. The full client (access token in memory, refresh token
 * from secure storage sent in the *body*, 401 → refresh → retry once → route to login) is §3.2 of
 * the implementation plan and lands with auth in Phase 1. What exists here is the part every
 * later version keeps: the absolute base URL, the `X-Client` header, and one place where response
 * envelopes and failures are unwrapped.
 *
 * Do not add `credentials: 'include'` when auth arrives. React Native has no cookie jar — that is
 * the whole reason P0-1 exists.
 */
import { API_URL, CLIENT_HEADER } from './config';

/** Every backend route answers with this envelope; see backend/src/middleware/errorHandler.ts. */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
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

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Client': CLIENT_HEADER,
      },
      signal,
    });
  } catch (cause) {
    // fetch rejects only on transport failure; any HTTP status resolves.
    throw new NetworkError(cause);
  }

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A non-JSON body means something upstream answered instead of the API — a proxy error page,
    // a captive portal. Fall through to the status-based message rather than crashing on parse.
  }

  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status
    );
  }

  return body.data as T;
}

/** P0-2 — the version gate. Public, and callable before the app has a session. */
export interface MinVersionResponse {
  platforms: Record<string, string>;
  client: { platform: string; version: string } | null;
  upgradeRequired: boolean;
}

export function fetchMinVersion(signal?: AbortSignal): Promise<MinVersionResponse> {
  return apiGet<MinVersionResponse>('/meta/min-version', signal);
}

/**
 * COPPA verifiable parental consent (growth roadmap §3.2), ported from the web's `consentApi`
 * (`frontend/src/lib/api.ts`).
 *
 * Backend routes (`backend/src/routes/consent.ts`), for reference:
 *
 *   GET  /consent/status  - parent-only; drives the UI
 *   POST /consent/request - parent-only; sends (or re-sends) the verification email
 *   POST /consent/verify  - PUBLIC; the emailed link, proof is possession of the token
 *
 * All three use the standard `{ success, data }` envelope — unlike `/reports/*` and
 * `/notifications/*`, nothing here needs `raw: true`. Confirmed by reading the handlers rather than
 * assumed, since the two raw exceptions elsewhere in the API make that the one detail worth checking
 * per endpoint rather than per module.
 *
 * `/verify` **is** ported now. It was left out originally because catching the emailed HTTPS link
 * needed an Android App Link and a route at the web's own path, which that port was not adding. Both
 * exist as of the App Links work: `app/parent/consent/confirm.tsx` matches
 * `/parent/consent/confirm` exactly, because an App Link is matched on the real URL path and the
 * `(parent)` group contributes nothing to it.
 *
 * It is called with `session: false`. The parent following this link on their phone may have no
 * TaskBuddy session on that device, and possession of the single-use token is the proof — sending an
 * Authorization header would be pointless, and refresh-then-retry on a 401 would be actively wrong.
 */
import { api } from './api';

export type ConsentStatus = 'none' | 'pending' | 'verified' | 'revoked';

export interface ConsentStatusResponse {
  status: ConsentStatus;
  /** The verification method used, e.g. `'email_plus'`. Null until a request has been made. */
  method: string | null;
  /** ISO string over the wire despite the backend's `Date` type — see `lib/dates.ts`. Unused today. */
  verifiedAt: Date | string | null;
  requestedAt: Date | string | null;
  /** The method the family would use for a *new* request, regardless of `method` above. */
  activeMethod: string;
}

export const CONSENT_STATUS_KEY = ['consent', 'status'] as const;

export function fetchConsentStatus(signal?: AbortSignal): Promise<ConsentStatusResponse> {
  return api.get<ConsentStatusResponse>('/consent/status', { signal });
}

export function consentStatusQuery() {
  return {
    queryKey: CONSENT_STATUS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchConsentStatus(signal),
  };
}

export interface RequestConsentResponse {
  status: 'pending';
  method: string;
  /** Server-authored, shown verbatim — "Check your email to confirm you are the parent." */
  message: string;
}

/**
 * Start (or restart) verification: sends the parent a confirmation email.
 *
 * Idempotent from the caller's side — requesting again while already `pending` just re-sends, which
 * is exactly what "I lost the email" needs. Requesting while already `verified` is a 409 from the
 * server (re-consenting should be a deliberate act, not a stray tap), which the screen surfaces like
 * any other request error rather than special-casing.
 */
export function requestConsent(): Promise<RequestConsentResponse> {
  return api.post<RequestConsentResponse>('/consent/request');
}

/**
 * Complete verification from the emailed token.
 *
 * PUBLIC: no session, by design. Idempotent server-side — a second tap on the same link resolves
 * rather than failing, so a parent who double-taps is not told their link is broken.
 */
export function verifyConsent(token: string): Promise<{ status: 'verified' }> {
  return api.post<{ status: 'verified' }>('/consent/verify', { token }, { session: false });
}

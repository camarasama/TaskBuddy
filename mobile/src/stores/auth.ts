/**
 * Session state (§3.3).
 *
 * Holds who is signed in and drives which navigation shell mounts. Three things here are decisions
 * rather than plumbing, and each is commented where it happens: what "offline at launch" means, why
 * admins are turned away, and why a failed keystore write has to fail the sign-in.
 */
import { create } from 'zustand';
import type { User } from '@taskbuddy/shared';

import { onSessionExpired, refreshSession } from '@/lib/api';
import * as authApi from '@/lib/authApi';
import { clearSession, hasStoredSession } from '@/lib/tokenStore';

export type SessionUser = Omit<User, 'passwordHash'>;

/**
 * `loading` is the launch state and must be distinguishable from `signedOut`, or the app flashes the
 * role chooser for a moment on every cold start of an already-signed-in session.
 */
export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * Set when launch could not reach the server but a stored credential still exists — the session is
   * probably fine and the token has deliberately NOT been discarded. Lets the sign-in screen say
   * "you appear to be offline" instead of implying the session ended.
   */
  offline: boolean;

  bootstrap: () => Promise<void>;
  signInParent: (email: string, password: string) => Promise<authApi.MfaChallengeRequired | null>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signInChild: (familyCode: string, childIdentifier: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * The token this device registered, remembered so sign-out can unregister exactly it.
 *
 * Module scope rather than store state: it is not rendered, and putting it in the store would make
 * every consumer re-render when it changes.
 */
let pushToken: string | null = null;

/**
 * Push, injected rather than imported.
 *
 * ⚠️ This store must NOT import `@/lib/push` directly. That module loads `expo-notifications`, whose
 * import has native side effects, and pulling it into this store's graph broke every test in
 * `auth.test.ts` — a store test failing because of a notifications package it never asked about.
 * The same trap cost a debugging session with `expo-image-picker` and `childTasksApi`; see
 * `src/lib/photoForm.ts`.
 *
 * Registered from the app layer, which is allowed to touch native modules. Unset in tests, where
 * both calls become no-ops.
 */
export interface PushBridge {
  register: () => Promise<string | null>;
  unregister: (token: string | null) => Promise<void>;
}

let pushBridge: PushBridge | null = null;

export function setPushBridge(bridge: PushBridge): void {
  pushBridge = bridge;
}

/**
 * Run after any successful sign-in.
 *
 * Deliberately not awaited by the callers. Registering asks for a permission and makes a network
 * call; blocking the transition into the app on either would mean a slow or refused prompt delaying
 * someone who just wants to see their tasks.
 */
async function afterSignIn(): Promise<void> {
  pushToken = (await pushBridge?.register()) ?? null;
}

/**
 * Reject an admin *after* the credentials were accepted.
 *
 * The tokens are already minted and stored by this point, so they are revoked server-side as well as
 * cleared locally — leaving a live 90-day refresh chain on a device that cannot use it would be
 * sloppy, and it would keep showing up in the parent's device list.
 */
async function rejectAdmin(): Promise<never> {
  await authApi.logout();
  throw new authApi.AdminNotSupportedError();
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  offline: false,

  /**
   * Restore a session on launch, if there is one to restore.
   *
   * The refresh token in the keystore is the source of truth for "is this device signed in": the
   * access token lives in memory and is always gone after a cold start, which is by design.
   */
  bootstrap: async () => {
    if (!(await hasStoredSession())) {
      set({ status: 'signedOut', user: null, offline: false });
      return;
    }

    const outcome = await refreshSession();

    if (outcome === 'offline') {
      // Keep the credential. A dead tunnel is not evidence the session ended, and this app is used
      // on phones in exactly the places where that happens.
      set({ status: 'signedOut', user: null, offline: true });
      return;
    }

    if (outcome === 'expired') {
      // performRefresh already cleared storage and notified listeners.
      set({ status: 'signedOut', user: null, offline: false });
      return;
    }

    try {
      const { user } = await authApi.fetchCurrentUser();
      if (user.role === 'admin') {
        await rejectAdmin();
      }
      set({ status: 'signedIn', user, offline: false });
    } catch {
      // The token refreshed but /auth/me failed — a deactivated account, or the server erroring.
      // Not worth guessing at: drop to signed out and let the user sign in again.
      await clearSession();
      set({ status: 'signedOut', user: null, offline: false });
    }
  },

  /**
   * Returns the MFA challenge when one is required, and null once a session exists. The caller
   * navigates to the TOTP screen on a non-null result — sign-in is not finished at that point.
   */
  signInParent: async (email, password) => {
    const result = await authApi.login({ email, password });
    if (authApi.isMfaChallenge(result)) return result;

    if (result.user.role === 'admin') await rejectAdmin();

    set({ status: 'signedIn', user: result.user, offline: false });
    void afterSignIn();
    return null;
  },

  completeMfa: async (mfaToken, code) => {
    const result = await authApi.completeMfaChallenge(mfaToken, code);
    if (result.user.role === 'admin') await rejectAdmin();
    set({ status: 'signedIn', user: result.user, offline: false });
    void afterSignIn();
  },

  signInChild: async (familyCode, childIdentifier, pin) => {
    const result = await authApi.childLogin({ familyCode, childIdentifier, pin });
    set({ status: 'signedIn', user: result.user, offline: false });
    void afterSignIn();
  },

  signOut: async () => {
    // BEFORE logout, while the session is still valid: the removal call is authenticated, and
    // running it afterwards would send it with a dead token and silently leave the device
    // registered to the person signing out.
    await pushBridge?.unregister(pushToken);
    pushToken = null;

    await authApi.logout();
    set({ status: 'signedOut', user: null, offline: false });
  },
}));

/**
 * Bridge the API client's expiry signal into this store.
 *
 * Registered once at module scope rather than in a component, because a session can expire during a
 * background refetch when no screen is mounted to have set up a subscription. `api.ts` publishes
 * rather than navigates precisely so this wiring can live here.
 */
onSessionExpired(() => {
  useAuth.setState({ status: 'signedOut', user: null, offline: false });
});

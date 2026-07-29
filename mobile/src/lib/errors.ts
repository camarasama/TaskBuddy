/**
 * Turning a thrown value into something worth showing a user.
 *
 * Kept out of the screens because all three sign-in screens need identical behaviour, and because the
 * distinctions matter: "check your connection" and "wrong password" call for different actions, and
 * collapsing them into "something went wrong" is what makes an app feel broken.
 */
import { ApiError, NetworkError, SessionExpiredError } from './api';
import { AdminNotSupportedError, CredentialStorageError } from './authApi';

export function describeError(error: unknown): string {
  // These four already carry messages written for a user to read.
  if (
    error instanceof NetworkError ||
    error instanceof SessionExpiredError ||
    error instanceof CredentialStorageError ||
    error instanceof AdminNotSupportedError
  ) {
    return error.message;
  }

  if (error instanceof ApiError) {
    // 5xx bodies say things like "Internal server error", which tells the user nothing actionable
    // and invites them to retype a correct password. 4xx messages are the backend's own validation
    // text and are worth showing verbatim.
    if (error.status >= 500) {
      return 'Something went wrong on our end. Please try again in a moment.';
    }
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

/**
 * Turning a thrown value into something worth showing a user.
 *
 * Kept out of the screens because all three sign-in screens need identical behaviour, and because the
 * distinctions matter: "check your connection" and "wrong password" call for different actions, and
 * collapsing them into "something went wrong" is what makes an app feel broken.
 */
import { ApiError, isRateLimited, NetworkError, SessionExpiredError } from './api';
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
    /**
     * The limiter's own message is "Too many requests", which reads as a fault and gives the user
     * nothing to act on. Say how long instead — `Retry-After` is on the response, so the number is
     * the server's, not a guess.
     *
     * Worth naming the shared-connection cause too: the limit is per IP, so the usual reason a
     * parent sees this is another device in the house, not anything they did.
     */
    if (isRateLimited(error)) {
      const wait = error.retryAfterSeconds;
      const when =
        wait === undefined
          ? 'in a few minutes'
          : wait < 60
            ? `in ${Math.max(1, Math.ceil(wait))} seconds`
            : `in about ${Math.ceil(wait / 60)} minutes`;
      return `Too many requests from your connection. Please try again ${when}. This limit is shared by every device on your network.`;
    }

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

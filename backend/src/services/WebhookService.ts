import crypto from 'crypto';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@taskbuddy/shared';
import { prisma } from './database';
import { encryptSecret, decryptSecret } from '../utils/mfa';
import { assertPublicHost, assertSafeWebhookUrl, UnsafeUrlError } from '../utils/ssrf';

/**
 * FR-18 — outbound webhooks.
 *
 * Families point TaskBuddy at Zapier / n8n / IFTTT and get an HMAC-signed POST when a subscribed
 * event fires. Three properties matter more than the plumbing:
 *
 *  - **The receiver must be able to trust the payload.** Every request carries a timestamp and an
 *    HMAC over `timestamp.body`, so a receiver can reject both forgeries and replays. Signing the
 *    body alone would let anyone who captured one delivery repeat it forever.
 *  - **The sender must not become an SSRF gadget.** See `utils/ssrf.ts`. Redirects are refused
 *    rather than followed — a public URL that 302s to 169.254.169.254 is the classic bypass.
 *  - **A dead endpoint must not degrade the app.** Dispatch is fire-and-forget with a short
 *    timeout and a bounded retry, and an endpoint that fails repeatedly disables itself.
 */

const DELIVERY_TIMEOUT_MS = 5_000;
/** Attempts per delivery, including the first. Two retries with a short backoff. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [1_000, 4_000];
/** Consecutive failed deliveries before the subscription is switched off. */
const FAILURE_LIMIT = 10;
/** Truncation cap for a stored error message — receivers can return an entire HTML page. */
const ERROR_MAX_LEN = 300;

export interface WebhookDeliveryResult {
  delivered: boolean;
  status?: number;
  error?: string;
}

export class WebhookService {
  /** Mint a signing secret. Shown to the parent once, then only ever stored encrypted. */
  static generateSecret(): string {
    return `whsec_${crypto.randomBytes(32).toString('hex')}`;
  }

  static encryptSecret(plain: string): string {
    return encryptSecret(plain);
  }

  /**
   * `sha256=<hex>` over `<timestamp>.<body>` — the receiver-facing contract, defined here and
   * nowhere else.
   *
   * A receiver verifies a delivery by reading `X-TaskBuddy-Timestamp`, recomputing
   * `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, comparing it to `X-TaskBuddy-Signature` in
   * constant time, and rejecting anything whose timestamp is too old. The timestamp is inside the
   * signed string precisely so that check cannot be stripped.
   */
  static sign(secret: string, timestamp: number, body: string): string {
    const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `sha256=${mac}`;
  }

  static isKnownEvent(event: string): event is WebhookEvent {
    return (WEBHOOK_EVENTS as readonly string[]).includes(event);
  }

  /** Validates a URL for storage. Re-exported here so routes have a single import. */
  static assertSafeUrl(url: string): void {
    assertSafeWebhookUrl(url);
  }

  // ── Delivery ───────────────────────────────────────────────────────────────

  /**
   * POST one payload to one subscription. Never throws: the outcome is returned and recorded, so a
   * failing webhook can never fail the parent action that triggered it.
   */
  static async deliver(
    subscription: { id: string; url: string; secret: string },
    event: WebhookEvent | 'ping',
    data: Record<string, unknown>
  ): Promise<WebhookDeliveryResult> {
    let secret: string;
    try {
      secret = decryptSecret(subscription.secret);
    } catch {
      // A secret that won't decrypt (rotated MFA_ENCRYPTION_KEY) can never produce a valid
      // signature; retrying is pointless and the parent needs to recreate the subscription.
      const result = { delivered: false, error: 'Signing secret could not be read.' };
      await this.recordOutcome(subscription.id, result);
      return result;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event, timestamp, data });
    const signature = this.sign(secret, timestamp, body);

    let last: WebhookDeliveryResult = { delivered: false, error: 'Not attempted.' };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      last = await this.attempt(subscription.url, body, event, timestamp, signature);
      // A 4xx is the receiver saying "don't send me this" — retrying just repeats the rejection.
      if (last.delivered || (last.status !== undefined && last.status < 500)) break;
      const delay = RETRY_DELAY_MS[attempt];
      if (delay !== undefined && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    await this.recordOutcome(subscription.id, last);
    return last;
  }

  private static async attempt(
    url: string,
    body: string,
    event: string,
    timestamp: number,
    signature: string
  ): Promise<WebhookDeliveryResult> {
    try {
      // Re-checked on every attempt, not just at save time: DNS answers change.
      await assertPublicHost(new URL(url).hostname);
    } catch (err) {
      return {
        delivered: false,
        error: err instanceof UnsafeUrlError ? err.message : 'Endpoint could not be verified.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TaskBuddy-Webhooks/1.0',
          'X-TaskBuddy-Event': event,
          'X-TaskBuddy-Timestamp': String(timestamp),
          'X-TaskBuddy-Signature': signature,
        },
        body,
        signal: controller.signal,
        // Never follow a redirect: it would re-target the request past the SSRF check.
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        return { delivered: false, status: response.status, error: 'Endpoint redirected; redirects are not followed.' };
      }
      if (!response.ok) {
        return { delivered: false, status: response.status, error: `Endpoint returned ${response.status}.` };
      }
      return { delivered: true, status: response.status };
    } catch (err: any) {
      const error = err?.name === 'AbortError' ? 'Endpoint timed out.' : 'Endpoint could not be reached.';
      return { delivered: false, error };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Persist delivery health, and switch off an endpoint that has failed FAILURE_LIMIT times. */
  private static async recordOutcome(id: string, result: WebhookDeliveryResult): Promise<void> {
    try {
      if (result.delivered) {
        await prisma.webhookSubscription.update({
          where: { id },
          data: {
            lastDeliveryAt: new Date(),
            lastStatus: result.status ?? null,
            lastError: null,
            consecutiveFailures: 0,
          },
        });
        return;
      }

      const current = await prisma.webhookSubscription.findUnique({
        where: { id },
        select: { consecutiveFailures: true },
      });
      const failures = (current?.consecutiveFailures ?? 0) + 1;
      const exhausted = failures >= FAILURE_LIMIT;

      await prisma.webhookSubscription.update({
        where: { id },
        data: {
          lastDeliveryAt: new Date(),
          lastStatus: result.status ?? null,
          lastError: result.error?.slice(0, ERROR_MAX_LEN) ?? null,
          consecutiveFailures: failures,
          ...(exhausted ? { isActive: false, disabledAt: new Date() } : {}),
        },
      });
    } catch {
      // Health bookkeeping must never break the delivery path — the row may have been deleted
      // mid-flight by a parent removing the subscription.
    }
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  /**
   * Fan an event out to every active subscription in a family, resolving once all deliveries have
   * settled. Awaitable so tests can assert on the outcome; production callers use
   * `dispatchDetached` instead, since a delivery can take seconds of retries.
   */
  static async dispatch(
    familyId: string,
    event: WebhookEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { familyId, isActive: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });
    if (subscriptions.length === 0) return;

    await Promise.allSettled(subscriptions.map((sub) => this.deliver(sub, event, data)));
  }

  /**
   * Same fan-out, detached. This is what event sources call: it returns immediately and swallows
   * everything, so a webhook can never turn an approval into a 500.
   */
  static dispatchDetached(familyId: string, event: WebhookEvent, data: Record<string, unknown>): void {
    this.dispatch(familyId, event, data).catch((err: any) =>
      console.error(`[WebhookService] dispatch of ${event} failed:`, err?.message)
    );
  }
}

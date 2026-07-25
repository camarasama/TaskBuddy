/**
 * WebhookService — FR-18 outbound webhooks for families.
 *
 * A family registers HTTPS endpoints; whenever a notification is created (createNotification() in
 * routes/notifications.ts is the single choke point every task/reward/scheduler path funnels
 * through) each subscribed endpoint gets a signed POST. That seam is why no per-route surgery is
 * needed: every notification type is subscribable for free.
 *
 * ─── Signature verification recipe (for the receiver: n8n / Zapier / a Lambda / whatever) ───
 *
 *   1. Read the RAW request body as bytes — do NOT parse-then-re-serialise. JSON key order and
 *      whitespace are part of what was signed; re-serialising will change the bytes and the HMAC
 *      will not match.
 *   2. expected = "sha256=" + hex(HMAC_SHA256(key = <your signing secret>, msg = <raw body>))
 *   3. Compare `expected` to the `X-TaskBuddy-Signature` header with a CONSTANT-TIME comparison
 *      (crypto.timingSafeEqual / hmac.compare / secrets.compare_digest).
 *   4. Replay defence: parse the body and check `body.timestamp` (RFC 3339 UTC) is within a few
 *      minutes of now, and remember `body.id` (a UUID) long enough to reject duplicates.
 *      NOTE: `X-TaskBuddy-Timestamp` and `X-TaskBuddy-Event` are convenience MIRRORS of the body
 *      fields. Headers are not covered by the signature — always trust `body.timestamp` /
 *      `body.event`, never the headers, when making a security decision.
 *
 *   Node example:
 *     const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
 *     const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
 *
 * ─── SSRF policy: HTTPS + public unicast IPs only ───
 *
 * The server POSTs to a URL an end user typed, so it is a textbook SSRF primitive. Policy:
 *   • https: only (no http:, no file:, no gopher:, no embedded credentials).
 *   • Every address the hostname resolves to must be public unicast — loopback, private, CGNAT,
 *     link-local (169.254.169.254 is the cloud metadata endpoint), unique-local, multicast,
 *     documentation and reserved ranges are all refused, for IPv4 and IPv6, literal or resolved.
 *   • Re-resolved and re-checked immediately before EVERY delivery attempt, not just at create —
 *     a hostname that resolved public on Tuesday can point at 127.0.0.1 on Wednesday (DNS
 *     rebinding).
 *   • redirect: 'manual' — a 302 to http://169.254.169.254/ would defeat every check above, so
 *     redirects are never followed. A 3xx is recorded as a failure.
 *
 * HONEST LIMITATION — residual TOCTOU. We resolve the hostname, approve the addresses, and then
 * hand the ORIGINAL URL to fetch(), which resolves it a second time itself. A DNS server that
 * answers differently between those two lookups (short TTL rebinding) can still steer the socket
 * at an internal address. Closing that window properly requires pinning the vetted IP at connect
 * time (a custom undici Agent with a `lookup` that returns only the approved address, plus SNI/Host
 * preservation). This defence therefore raises the cost of the attack substantially but is NOT
 * total. The blast radius is bounded by the deliberate decision to accept only public targets, so
 * an attacker must control public DNS for the name they registered.
 *
 * Deliberately NOT taken: an allowlist of known-good providers. The whole point of FR-18 is
 * arbitrary n8n / Zapier / IFTTT endpoints. The trade is that a home-LAN n8n cannot be targeted —
 * that is the owner's decision, not an oversight.
 */

import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { prisma } from './database';
import { config } from '../config';
import { encryptSecret, decryptSecret } from '../utils/mfa';
import { WEBHOOK_EVENTS, WEBHOOK_MAX_CONSECUTIVE_FAILURES } from '@taskbuddy/shared';
import type { WebhookEvent, WebhookFailureEntry } from '@taskbuddy/shared';

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Hard per-attempt timeout. A hanging endpoint must not tie up a socket indefinitely. */
const DELIVERY_TIMEOUT_MS = 5_000;
/** Total attempts per delivery (1 initial + 2 retries). */
const MAX_ATTEMPTS = 3;
/** How many failure records we keep on the subscription for the parent UI. */
const MAX_RECENT_FAILURES = 10;
/** Failure reasons are remote-controlled strings — cap them before they hit the DB. */
const MAX_REASON_LEN = 200;

/**
 * The notification type emitted when we auto-disable a subscription. It is deliberately NOT in
 * WEBHOOK_EVENTS, so it can never be subscribed to, and dispatch() hard-skips it as well: without
 * that guard a dead endpoint would fail → emit "webhook disabled" → dispatch → fail → emit … .
 */
export const WEBHOOK_DISABLED_NOTIFICATION = 'webhook_disabled';

const DISPATCHABLE: ReadonlySet<string> = new Set<string>(WEBHOOK_EVENTS);

// ─── SSRF guard ──────────────────────────────────────────────────────────────

/** Thrown for any URL that fails policy. The message is safe to show the parent. */
export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

function ipv4ToBytes(value: string): number[] | null {
  // net.isIPv4 rejects leading zeros / octal-ish forms ("0177.0.0.1"), which is what we want:
  // those are a classic parser-confusion SSRF bypass.
  if (!net.isIPv4(value)) return null;
  return value.split('.').map((o) => parseInt(o, 10));
}

/** Expands any valid IPv6 textual form (including `::` and a trailing dotted quad) to 16 bytes. */
function ipv6ToBytes(input: string): Uint8Array | null {
  let text = input.split('%')[0]; // drop a zone id such as fe80::1%eth0
  if (!net.isIPv6(text)) return null;

  // Pull a trailing embedded IPv4 (::ffff:127.0.0.1) out and stand in two placeholder groups.
  let embeddedV4: number[] | null = null;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    embeddedV4 = ipv4ToBytes(text.slice(lastColon + 1));
    if (!embeddedV4) return null;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;

  const groups: number[] = [...head.map((g) => parseInt(g, 16))];
  if (halves.length === 2) {
    for (let i = head.length + tail.length; i < 8; i++) groups.push(0);
  }
  groups.push(...tail.map((g) => parseInt(g, 16)));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  if (embeddedV4) bytes.set(embeddedV4, 12);
  return bytes;
}

/** Returns a human reason when the IPv4 address is NOT public unicast, else null. */
function ipv4RejectReason(b: number[]): string | null {
  const [a, c, d] = b;
  if (a === 0) return 'this-network (0.0.0.0/8)';
  if (a === 10) return 'private (10.0.0.0/8)';
  if (a === 127) return 'loopback (127.0.0.0/8)';
  if (a === 100 && c >= 64 && c <= 127) return 'carrier-grade NAT (100.64.0.0/10)';
  if (a === 169 && c === 254) return 'link-local / cloud metadata (169.254.0.0/16)';
  if (a === 172 && c >= 16 && c <= 31) return 'private (172.16.0.0/12)';
  if (a === 192 && c === 0 && d === 0) return 'IETF protocol assignments (192.0.0.0/24)';
  if (a === 192 && c === 0 && d === 2) return 'documentation TEST-NET-1 (192.0.2.0/24)';
  if (a === 192 && c === 168) return 'private (192.168.0.0/16)';
  if (a === 198 && (c === 18 || c === 19)) return 'benchmarking (198.18.0.0/15)';
  if (a === 198 && c === 51 && d === 100) return 'documentation TEST-NET-2 (198.51.100.0/24)';
  if (a === 203 && c === 0 && d === 113) return 'documentation TEST-NET-3 (203.0.113.0/24)';
  if (a >= 224 && a <= 239) return 'multicast (224.0.0.0/4)';
  if (a >= 240) return 'reserved / broadcast (240.0.0.0/4)';
  return null;
}

/** Returns a human reason when the IPv6 address is NOT public unicast, else null. */
function ipv6RejectReason(b: Uint8Array): string | null {
  const topTenZero = b.slice(0, 10).every((x) => x === 0);

  // ::ffff:a.b.c.d — IPv4-mapped. Judge the embedded IPv4, otherwise ::ffff:127.0.0.1 walks in.
  if (topTenZero && b[10] === 0xff && b[11] === 0xff) {
    const reason = ipv4RejectReason([b[12], b[13], b[14], b[15]]);
    return reason ? `IPv4-mapped → ${reason}` : null;
  }
  if (topTenZero && b[10] === 0 && b[11] === 0) {
    if (b.every((x) => x === 0)) return 'unspecified (::)';
    if (b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 1) return 'loopback (::1)';
    return 'IPv4-compatible / reserved (::/96)';
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return 'NAT64 (64:ff9b::/96)';
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((x) => x === 0)) return 'discard-only (100::/64)';
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return 'documentation (2001:db8::/32)';
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] & 0xfe) === 0x00) return 'IETF assignments / Teredo (2001::/23)';
  if (b[0] === 0x20 && b[1] === 0x02) return '6to4 tunnel (2002::/16)';
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0x00) return 'documentation (3fff::/20, RFC 9637)';
  if ((b[0] & 0xfe) === 0xfc) return 'unique-local (fc00::/7)';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'link-local (fe80::/10)';
  if (b[0] === 0xff) return 'multicast (ff00::/8)';
  // Everything that is not inside global unicast 2000::/3 is out of scope for a public endpoint.
  if ((b[0] & 0xe0) !== 0x20) return 'outside global unicast (2000::/3)';
  return null;
}

/** Returns a human reason when a literal address string is not an allowed target, else null. */
export function ipRejectReason(address: string): string | null {
  const v4 = ipv4ToBytes(address);
  if (v4) return ipv4RejectReason(v4);
  const v6 = ipv6ToBytes(address);
  if (v6) return ipv6RejectReason(v6);
  return 'unparseable address';
}

export interface SafeUrlResult {
  url: URL;
  /** Every address the hostname resolved to, all of which passed policy. */
  addresses: string[];
}

/**
 * Full policy check. Throws WebhookUrlError with a parent-readable reason.
 * Called at CREATE and again immediately before EVERY delivery attempt.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('That is not a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new WebhookUrlError('Webhook URLs must use https:// — plain HTTP is not accepted.');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('Webhook URLs must not contain embedded credentials.');
  }

  // URL.hostname wraps an IPv6 literal in brackets; strip them before parsing.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new WebhookUrlError('That URL has no hostname.');

  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      const records = await dns.lookup(host, { all: true, verbatim: true });
      addresses = records.map((r) => r.address);
    } catch {
      throw new WebhookUrlError(`Could not resolve "${host}".`);
    }
  }

  if (addresses.length === 0) throw new WebhookUrlError(`"${host}" does not resolve to any address.`);

  for (const address of addresses) {
    const reason = ipRejectReason(address);
    if (reason) {
      throw new WebhookUrlError(
        `"${host}" resolves to ${address}, which is ${reason}. Only endpoints on public internet addresses are allowed.`,
      );
    }
  }

  return { url, addresses };
}

// ─── Secret at rest ──────────────────────────────────────────────────────────

/**
 * Reuses the AES-256-GCM helpers written for the admin TOTP secret (utils/mfa.ts) — they are
 * generic over any string. They do, however, hard-require MFA_ENCRYPTION_KEY, and webhooks must
 * keep working on a deployment that never turned admin MFA on. So: encrypt when a key is
 * configured, otherwise store the raw hex. The two are unambiguous because the encrypted envelope
 * is `iv:tag:ciphertext` (two colons) and a raw secret is colon-free hex.
 */
export function sealWebhookSecret(plain: string): string {
  if (!config.mfa.encryptionKey) return plain;
  return encryptSecret(plain);
}

export function openWebhookSecret(stored: string): string {
  if (stored.split(':').length !== 3) return stored;
  return decryptSecret(stored);
}

// ─── Service ─────────────────────────────────────────────────────────────────

interface DeliverySubscription {
  id: string;
  familyId: string;
  url: string;
  secret: string;
  failureCount: number;
  recentFailures: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(text: string): string {
  return text.length > MAX_REASON_LEN ? `${text.slice(0, MAX_REASON_LEN)}…` : text;
}

export class WebhookService {
  /**
   * Backoff between delivery attempts (attempt 2 waits retryDelaysMs[0], attempt 3 waits [1]).
   * Mutable so tests can collapse the waits instead of sleeping for real.
   */
  static retryDelaysMs: number[] = [500, 2_000];

  /** 32 bytes of hex — the HMAC signing key handed to the parent. */
  static generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** `sha256=<hex>` over the EXACT raw body bytes. */
  static sign(secret: string, rawBody: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  }

  /**
   * Fan a notification out to every matching subscription. FIRE-AND-FORGET: callers must not await
   * this (createNotification uses `.catch(() => {})`, matching how PushService.sendPush is called),
   * and nothing in here is allowed to throw into the originating request.
   */
  static async dispatch(params: {
    userId: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Loop guard + allowlist in one: an unknown type (and specifically the auto-disable notice)
      // never reaches the network.
      if (!DISPATCHABLE.has(params.event)) return;

      // createNotification only knows a userId, but subscriptions are per-family. One query rather
      // than threading familyId through every call site: find active subs whose family contains
      // this user.
      const subs = await prisma.webhookSubscription.findMany({
        where: {
          isActive: true,
          events: { has: params.event },
          family: { users: { some: { id: params.userId } } },
        },
        select: {
          id: true,
          familyId: true,
          url: true,
          secret: true,
          failureCount: true,
          recentFailures: true,
        },
      });
      if (subs.length === 0) return;

      await Promise.allSettled(
        subs.map((sub) => this.deliver(sub as DeliverySubscription, params.event as WebhookEvent, params.payload)),
      );
    } catch (err) {
      console.error('[WebhookService.dispatch] failed:', err);
    }
  }

  /** One subscription, up to MAX_ATTEMPTS tries. Never throws. */
  private static async deliver(
    sub: DeliverySubscription,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<void> {
    const deliveryId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    // Serialise ONCE: these exact bytes are both signed and sent.
    const rawBody = JSON.stringify({ id: deliveryId, event, timestamp, familyId: sub.familyId, data });

    let signature: string;
    try {
      signature = this.sign(openWebhookSecret(sub.secret), rawBody);
    } catch {
      await this.recordFailure(sub, event, 'signing secret could not be read');
      return;
    }

    let reason = 'no attempt made';
    let status: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await sleep(this.retryDelaysMs[attempt - 2] ?? 1_000);

      // DNS rebinding defence: re-resolve and re-check on EVERY attempt, not once at create.
      try {
        await assertSafeWebhookUrl(sub.url);
      } catch (err) {
        reason = `blocked by SSRF policy: ${err instanceof Error ? err.message : String(err)}`;
        break; // a policy failure will not fix itself on retry
      }

      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          redirect: 'manual', // a 302 to an internal address would defeat every check above
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TaskBuddy-Webhook/1',
            'X-TaskBuddy-Event': event,
            'X-TaskBuddy-Delivery': deliveryId,
            'X-TaskBuddy-Timestamp': timestamp,
            'X-TaskBuddy-Signature': signature,
          },
          body: rawBody,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });

        // We never use the response body; release the connection rather than leaking it.
        try {
          await res.body?.cancel();
        } catch {
          /* nothing useful to do */
        }

        status = res.status;
        if (res.status >= 200 && res.status < 300) {
          await this.recordSuccess(sub.id);
          return;
        }
        if (res.status >= 300 && res.status < 400) {
          reason = `HTTP ${res.status} redirect — redirects are never followed`;
          break;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          reason = `HTTP ${res.status} — endpoint rejected the delivery`;
          break; // a deliberate 4xx is not retried
        }
        reason = `HTTP ${res.status}`; // 5xx and 429 fall through to a retry
      } catch (err) {
        reason = `network error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    await this.recordFailure(sub, event, reason, status);
  }

  private static async recordSuccess(id: string): Promise<void> {
    try {
      await prisma.webhookSubscription.update({
        where: { id },
        data: { failureCount: 0, lastSuccessAt: new Date() },
      });
    } catch (err) {
      console.error('[WebhookService] could not record success:', err);
    }
  }

  private static async recordFailure(
    sub: DeliverySubscription,
    event: string,
    reason: string,
    status?: number,
  ): Promise<void> {
    try {
      const previous = Array.isArray(sub.recentFailures) ? (sub.recentFailures as WebhookFailureEntry[]) : [];
      const entry: WebhookFailureEntry = {
        at: new Date().toISOString(),
        event,
        reason: clip(reason),
        ...(status === undefined ? {} : { status }),
      };
      const failureCount = sub.failureCount + 1;
      const autoDisable = failureCount >= WEBHOOK_MAX_CONSECUTIVE_FAILURES;

      await prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: {
          failureCount,
          lastFailureAt: entry.at,
          recentFailures: [entry, ...previous].slice(0, MAX_RECENT_FAILURES) as unknown as object,
          ...(autoDisable ? { isActive: false, disabledAt: new Date() } : {}),
        },
      });

      if (autoDisable) await this.notifyDisabled(sub, entry.reason);
    } catch (err) {
      console.error('[WebhookService] could not record failure:', err);
    }
  }

  /** Tell the family's parents their endpoint was switched off. */
  private static async notifyDisabled(sub: DeliverySubscription, reason: string): Promise<void> {
    try {
      // Lazy require: routes/notifications imports this module, so a top-level import would be a
      // cycle that bites at module-init time.
      const { createNotification } = await import('../routes/notifications');
      const parents = await prisma.user.findMany({
        where: { familyId: sub.familyId, role: { in: ['parent', 'admin'] }, deletedAt: null },
        select: { id: true },
      });
      await Promise.allSettled(
        parents.map((parent) =>
          createNotification({
            userId: parent.id,
            // NOT a WEBHOOK_EVENTS member, and dispatch() skips it — otherwise this very
            // notification would kick off another delivery round against the dead endpoint.
            notificationType: WEBHOOK_DISABLED_NOTIFICATION,
            title: '🔌 Webhook disabled',
            message: `Deliveries to ${sub.url} failed ${WEBHOOK_MAX_CONSECUTIVE_FAILURES} times in a row (${reason}). It has been switched off — re-add it from Settings once the endpoint is healthy.`,
            actionUrl: '/parent/settings',
            referenceType: 'webhook_subscription',
            referenceId: sub.id,
          }),
        ),
      );
    } catch (err) {
      console.error('[WebhookService] could not notify about auto-disable:', err);
    }
  }
}

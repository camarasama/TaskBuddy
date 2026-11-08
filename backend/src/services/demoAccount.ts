/**
 * The public demo family (families.is_demo_account).
 *
 * Its parent and child logins are posted publicly (launch sites, Reddit), so anyone can sign in as
 * them. Normal use stays open: create and approve tasks, redeem rewards, play games. What is closed
 * is anything that would lock the next visitor out, delete the account, send email to an address a
 * stranger typed, upload files, call outside URLs, or show another visitor's IP address.
 *
 * Three pieces enforce it:
 *  - middleware/demoGuard.ts refuses the routes in DEMO_BLOCKED_ROUTES for this family;
 *  - EmailService.send drops every email to this family, so no visitor's action reaches an inbox;
 *  - AuthService skips the failed-login lockout, because the credentials are public anyway and
 *    the lockout would only let one visitor lock everyone else out.
 *
 * Created by scripts/create-demo-family.ts. Also flagged is_test_account, so admin KPIs skip it.
 */
import { prisma } from './database';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface BlockedRoute {
  methods: Method[] | '*';
  /** Matched against the path below /api/v1, without a trailing slash, case-insensitively. */
  pattern: RegExp;
}

const id = '[^/]+';
const r = (p: string) => new RegExp(`^${p}$`, 'i');

export const DEMO_BLOCKED_ROUTES: BlockedRoute[] = [
  // Lock-out: credentials, MFA, the family code children sign in with, child PINs.
  { methods: ['PUT'], pattern: r('/auth/password') },
  { methods: ['PUT'], pattern: r('/auth/me') },
  { methods: ['POST'], pattern: r('/auth/mfa/(setup|enable|disable)') },
  { methods: ['POST'], pattern: r('/auth/child/pin/setup') },
  { methods: ['POST'], pattern: r('/auth/family/regenerate-code') },
  { methods: ['PUT', 'DELETE'], pattern: r(`/families/me/children/${id}`) },
  // Signing other visitors out, and the device list (it shows their IP addresses).
  { methods: '*', pattern: r('/sessions(/.*)?') },
  // Deleting or reshaping the account.
  { methods: ['PUT'], pattern: r('/families/me') },
  { methods: ['POST', 'DELETE'], pattern: r('/families/me/deletion') },
  { methods: ['DELETE'], pattern: r(`/families/me/parents/${id}`) },
  { methods: ['POST'], pattern: r(`/families/me/transitions/${id}/resolve`) },
  // Email to addresses a visitor types: co-parent invites, new children (welcome + consent mail).
  { methods: ['POST'], pattern: r('/families/me/invite') },
  { methods: ['DELETE'], pattern: r(`/families/me/invitations/${id}`) },
  { methods: ['POST'], pattern: r('/families/me/children') },
  { methods: ['POST'], pattern: r('/consent/(request|verify)') },
  // File uploads: strangers' photos must not land in a children's app.
  { methods: ['POST'], pattern: r('/auth/upload-image') },
  { methods: ['POST'], pattern: r('/families/me/my-avatar-photo') },
  { methods: ['POST'], pattern: r(`/tasks/assignments/${id}/upload`) },
  // Outbound calls from our server to a URL a visitor chose.
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: r('/webhooks(/.*)?') },
  // Push to a visitor's own device, forever, for whatever the next visitor does.
  { methods: ['POST'], pattern: r('/notifications/push/(subscribe|expo-token)') },
  // Audit trail, email log and full export: they hold other visitors' IP addresses.
  { methods: '*', pattern: r('/reports(/.*)?') },
  { methods: ['GET'], pattern: r('/families/me/export') },
];

/** True when this request is one the demo family may not make. Path is relative to /api/v1. */
export function isBlockedForDemo(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return DEMO_BLOCKED_ROUTES.some(
    (route) => (route.methods === '*' || route.methods.includes(m as Method)) && route.pattern.test(p),
  );
}

// The flag is set once at creation and never cleared, so a short cache is safe and keeps the guard
// off the database for every request. Per process: each cluster worker keeps its own.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expires: number }>();

export async function isDemoFamily(familyId: string | null | undefined): Promise<boolean> {
  if (!familyId) return false;
  const hit = cache.get(familyId);
  if (hit && hit.expires > Date.now()) return hit.value;

  // Fails open: a failed lookup must never block a real family's request, email or login. The cost
  // is that the demo family is unguarded for that one call, while the database is failing anyway.
  let value: boolean;
  try {
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: { isDemoAccount: true },
    });
    value = family?.isDemoAccount === true;
  } catch (err) {
    console.error('[demoAccount] demo-family lookup failed:', (err as Error)?.message);
    return false;
  }
  cache.set(familyId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Tests only. */
export function clearDemoFamilyCache(): void {
  cache.clear();
}

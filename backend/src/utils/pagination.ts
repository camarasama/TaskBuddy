/**
 * utils/pagination.ts — one pagination contract for every list endpoint (FR-07).
 *
 * `admin.ts` already had a correct page/limit implementation; this lifts that shape into a shared
 * helper so the family-facing endpoints don't each invent their own. The contract is:
 *
 *   request:   ?page=1&limit=20
 *   response:  { <items>, pagination: { page, limit, total, totalPages, hasMore } }
 *
 * `total` is a real `count()` over the same `where` clause — not the length of the returned batch.
 * That distinction matters: `/notifications` previously reported `total: notifications.length`,
 * which always equalled the page size and so could never tell a client another page existed.
 */

import { z } from 'zod';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** `page`/`limit` query schema. Extend it when an endpoint has its own filters. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Turn validated query params into Prisma's `skip`/`take`.
 *
 * Callers that are not behind `validateQuery(paginationSchema)` can pass raw query values; the
 * bounds below are applied defensively either way, so an unbounded `?limit=100000` can never reach
 * the database.
 */
export function toSkipTake(query: { page?: unknown; limit?: unknown }): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const parsed = paginationSchema.safeParse(query);
  const { page, limit } = parsed.success
    ? parsed.data
    : { page: 1, limit: DEFAULT_LIMIT };
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasMore: page < totalPages };
}

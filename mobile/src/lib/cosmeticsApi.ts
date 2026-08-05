/**
 * Avatar cosmetics — the child's own points sink (growth roadmap §4.4).
 *
 * Everything here costs points earned from tasks. **There is no real-money path and there must never be
 * one**; the route file states this as binding under the ethics guardrails for a children's product, and
 * it is repeated here because this is the module a future "add IAP" change would touch first.
 *
 * Owning and wearing are separate: unequipping takes an item off without giving the points back, so a
 * child can change their mind about a look without losing the thing they bought.
 */
import { api } from './api';
import { CHILD_DASHBOARD_KEY } from './childDashboardApi';

export interface CosmeticRow {
  id: string;
  category: string;
  name: string;
  description: string | null;
  /** Identifier for the artwork. Rendered as a label until the asset set ships. */
  assetKey: string;
  pointsCost: number;
  owned: boolean;
  equipped: boolean;
  /** Server's affordability verdict, so the device never disagrees with the balance it enforces. */
  affordable: boolean;
}

export interface CosmeticsResponse {
  items: CosmeticRow[];
  pointsBalance: number;
}

export const COSMETICS_KEY = ['cosmetics', 'child'] as const;

export function fetchCosmetics(signal?: AbortSignal): Promise<CosmeticsResponse> {
  return api.get<CosmeticsResponse>('/cosmetics', { signal });
}

export function cosmeticsQuery() {
  return {
    queryKey: COSMETICS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchCosmetics(signal),
  };
}

/** Spend points. Atomic through the points ledger server-side. */
export function buyCosmetic(itemId: string): Promise<unknown> {
  return api.post(`/cosmetics/${itemId}/buy`, {});
}

/** Wear or remove an owned item. Removing does not refund — ownership is untouched. */
export function setEquipped(itemId: string, equipped: boolean): Promise<unknown> {
  return equipped
    ? api.put(`/cosmetics/${itemId}/equip`, {})
    : api.delete(`/cosmetics/${itemId}/equip`);
}

/**
 * Buying moves the points balance, so the dashboard goes with it. Equipping does not cost anything, but
 * shares the list invalidation because only one item per category can be worn — equipping one silently
 * unequips its neighbour, and a stale list would show two.
 */
export const INVALIDATED_BY_COSMETIC_ACTION = [COSMETICS_KEY, CHILD_DASHBOARD_KEY] as const;

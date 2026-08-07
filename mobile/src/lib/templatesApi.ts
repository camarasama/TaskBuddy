/**
 * Starter content — the task template library and the reward presets (growth roadmap §3.1).
 *
 * The roadmap's #1 activation item: a blank task list at signup asks a parent to invent chores at the
 * moment they have least patience, and that is the biggest measured drop-off. So both parent create
 * forms can open a list of ready-made rows and pre-fill themselves from one.
 *
 * ## Picker-on-create, not a library screen and not pack application
 *
 * The web has three entry points into this content: browse a pack, apply a whole pack at once, or pick
 * one template to edit. Only the last is built here. Applying a pack creates several tasks in one tap
 * and then has to explain that CR-10 held some of them back — a paragraph of consequence on a phone
 * screen, for a flow a parent reaches while already creating one specific task. `POST
 * /templates/packs/:category` and `GET /templates/packs` are deliberately not wrapped.
 *
 * ## These routes DO use the `{ success, data }` envelope
 *
 * Checked, not assumed: every handler in `backend/src/routes/templates.ts` answers
 * `res.json({ success: true, data: … })`. So no `{ raw: true }` here — unlike `/notifications/*` and
 * `/reports/*`, which answer bare and throw on a 200 through the normal path. If a template call ever
 * starts failing on a healthy 200, that is the first thing to re-check.
 *
 * ## Why the fill helpers live here rather than in the screens
 *
 * A template is *content*, and content can be older than the validation it has to satisfy: a row
 * seeded before the points floor moved, or a family-authored template whose points were written by an
 * earlier admin screen. Handing those numbers straight to a form produces a form that cannot be
 * submitted and does not say why. Clamping happens once, in a pure function, with tests — rather than
 * twice, in two screens, from memory.
 */
import type { RankedRewardPreset, TaskTemplateRow } from '@taskbuddy/shared';

import { api } from './api';

export interface TaskTemplatesResponse {
  templates: TaskTemplateRow[];
}

export interface RewardPresetsResponse {
  presets: RankedRewardPreset[];
}

export const TASK_TEMPLATES_KEY = ['templates', 'tasks'] as const;
export const REWARD_PRESETS_KEY = ['templates', 'rewards'] as const;

/**
 * Templates the family may use: the shipped system rows plus anything they authored themselves.
 *
 * `childId` narrows to what suits that child's real date of birth — the server reads the DOB, the
 * client never sends an age. Passed when the parent has already ticked someone in the assignment
 * picker, because "wipe the whiteboard" is a different suggestion for a ten-year-old than a sixteen-
 * year-old, and offering both is how a template list stops feeling curated.
 */
export function fetchTaskTemplates(
  childId?: string,
  signal?: AbortSignal
): Promise<TaskTemplatesResponse> {
  const query = childId ? `?childId=${encodeURIComponent(childId)}` : '';
  return api.get<TaskTemplatesResponse>(`/templates/tasks${query}`, { signal });
}

/** Reward ideas, ranked by what families actually redeem (U19). */
export function fetchRewardPresets(signal?: AbortSignal): Promise<RewardPresetsResponse> {
  return api.get<RewardPresetsResponse>('/templates/rewards', { signal });
}

/**
 * Keyed on the child, because the payload differs per child — a single key would serve one child's
 * age-filtered list to the next one picked.
 */
export function taskTemplatesQuery(childId?: string) {
  return {
    queryKey: [...TASK_TEMPLATES_KEY, childId ?? 'all'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTaskTemplates(childId, signal),
    // Shipped content plus a family library that only an admin screen writes to. Refetching it every
    // time the sheet opens spends a request from a 100-per-15-minutes IP bucket for an identical list.
    staleTime: 5 * 60 * 1000,
  };
}

export function rewardPresetsQuery() {
  return {
    queryKey: REWARD_PRESETS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRewardPresets(signal),
    // Shorter than the templates': the ordering and the `alreadyAdded` flag both move as the family
    // redeems and creates rewards, so a long cache would show a stale ranking as if it were current.
    staleTime: 60 * 1000,
  };
}

// ── Filling a form from a row ────────────────────────────────────────────────

/**
 * The server's own bounds, restated.
 *
 * Not imported from the forms: the dependency runs the other way — a screen asks this module for
 * values it can already submit. `VALIDATION.POINTS.MIN` in `shared` is 1, which is the *reward* floor;
 * the task schema in `backend/src/routes/tasks.ts` is 5–1000, and that is the one a task form obeys.
 */
const MIN_TASK_POINTS = 5;
const MAX_TASK_POINTS = 1000;
const MAX_ESTIMATED_MINUTES = 480;
const MIN_REWARD_COST = 1;
const MAX_REWARD_COST = 100000;

/** Default when a template carries a points value that is not a usable number at all. */
const FALLBACK_TASK_POINTS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * What a task template sets on the create form.
 *
 * Strings, not numbers, because the form's fields are `TextInput`s and the parent must be able to
 * clear one after picking. Handing back a number would force each screen to stringify and would lose
 * the distinction between "empty" and "zero" on the optional ones.
 */
export interface TaskTemplateFill {
  title: string;
  description: string;
  points: string;
  /** Empty when the template does not say. */
  estimatedMinutes: string;
  requiresPhotoEvidence: boolean;
}

/**
 * Pre-fill values for a task template.
 *
 * Note what is **not** here: `difficulty`. Templates carry one, the create endpoint derives its own
 * from `pointsValue`, and copying the template's across would put a field on the wire that the server
 * silently overrules. `parentWriteApi.test.ts` guards the endpoint; this comment guards the temptation.
 *
 * `taskTag` is likewise absent. The web sets `secondary` here so a pack of starter chores does not
 * collide with CR-10's one-active-primary rule, but the mobile form has no tag control at all and
 * defaults to `primary` server-side — introducing the field only on the template path would make two
 * routes to the same form produce different tasks.
 */
export function fillFromTaskTemplate(template: TaskTemplateRow): TaskTemplateFill {
  const suggested = template.suggestedPoints;
  const points = Number.isFinite(suggested)
    ? clamp(suggested, MIN_TASK_POINTS, MAX_TASK_POINTS)
    : FALLBACK_TASK_POINTS;

  const minutes = template.estimatedMinutes;
  const estimatedMinutes =
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 1
      ? String(clamp(minutes, 1, MAX_ESTIMATED_MINUTES))
      : '';

  return {
    // Trimmed to the same lengths the fields accept. A `TextInput` with `maxLength` silently refuses
    // to shrink a value set programmatically above it, so an over-long template would otherwise sit in
    // the form as text the parent cannot fix by typing.
    title: template.name.slice(0, 200),
    description: (template.description ?? '').slice(0, 1000),
    points: String(points),
    estimatedMinutes,
    requiresPhotoEvidence: template.requiresPhotoEvidence,
  };
}

export interface RewardPresetFill {
  name: string;
  description: string;
  cost: string;
}

/** Pre-fill values for a reward preset. Caps are left alone: a preset has no opinion on them. */
export function fillFromRewardPreset(preset: RankedRewardPreset): RewardPresetFill {
  const cost = Number.isFinite(preset.pointsCost)
    ? clamp(preset.pointsCost, MIN_REWARD_COST, MAX_REWARD_COST)
    : MIN_REWARD_COST;

  return {
    name: preset.name.slice(0, 100),
    description: preset.description.slice(0, 500),
    cost: String(cost),
  };
}

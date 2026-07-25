/**
 * services/TemplateService.ts — task template library (growth roadmap §3.1, the #1 activation item).
 *
 * The interesting decision here is what "add a pack" means.
 *
 * The roadmap says a pack is added *for a selected child*. But CR-10 (`utils/assignmentLimits.ts`)
 * caps a child at 3 active assignments, of which at most 1 may be primary — so a 6-task pack cannot
 * be assigned wholesale. That cap is a deliberate focus guard for a children's product, not an
 * oversight, and raising it to make an activation feature work would be the wrong trade.
 *
 * So a pack always populates the family's task LIBRARY in full, and then assigns greedily up to the
 * child's remaining capacity, reporting honestly how many were held back. The parent assigns the
 * rest as their child finishes things — which is the behaviour the cap exists to encourage.
 */

import { prisma } from './database';
import { isAgeAppropriate } from './GameService';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { SYSTEM_TEMPLATES } from '../routes/templatesSeed';

/** CR-10 caps, mirrored here so the greedy assign can reason about them without N queries. */
const MAX_ACTIVE_TOTAL = 3;

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  suggestedPoints: number;
  estimatedMinutes: number | null;
  ageRange: string | null;
  requiresPhotoEvidence: boolean;
  isSystemTemplate: boolean;
}

export interface ApplyPackResult {
  category: string;
  created: number;
  assigned: number;
  /** Created but left unassigned because the child was at capacity. */
  skippedForCapacity: number;
  message: string;
}

/**
 * Templates visible to a family: the shipped system set plus that family's own.
 *
 * Never returns another family's templates — `familyId` is either null (system) or exactly this
 * family. Guarded by a cross-family test.
 */
export async function listTemplates(params: {
  familyId: string;
  category?: string;
  /** When given, only templates appropriate for this child's real date of birth are returned. */
  childId?: string;
}): Promise<TemplateRow[]> {
  const { familyId, category, childId } = params;

  let dateOfBirth: Date | null = null;
  if (childId) {
    const child = await prisma.user.findFirst({
      where: { id: childId, familyId, role: 'child', deletedAt: null },
      include: { childProfile: { select: { dateOfBirth: true } } },
    });
    if (!child) throw new NotFoundError('Child not found');
    dateOfBirth = child.childProfile?.dateOfBirth ?? null;
  }

  const rows = await prisma.taskTemplate.findMany({
    where: {
      OR: [{ isSystemTemplate: true }, { familyId }],
      ...(category ? { category } : {}),
    },
    orderBy: [{ isSystemTemplate: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });

  const visible = childId
    ? rows.filter((t) => isAgeAppropriate(t.ageRange, dateOfBirth))
    : rows;

  return visible.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    difficulty: t.difficulty,
    suggestedPoints: t.suggestedPoints,
    estimatedMinutes: t.estimatedMinutes,
    ageRange: t.ageRange,
    requiresPhotoEvidence: t.requiresPhotoEvidence,
    isSystemTemplate: t.isSystemTemplate,
  }));
}

/** Pack summaries for the browse screen. */
export async function listPacks(familyId: string): Promise<
  Array<{ category: string; templateCount: number; ageRanges: string[] }>
> {
  const rows = await prisma.taskTemplate.findMany({
    where: { OR: [{ isSystemTemplate: true }, { familyId }] },
    select: { category: true, ageRange: true },
  });

  const byCategory = new Map<string, { count: number; ages: Set<string> }>();
  for (const r of rows) {
    const key = r.category ?? 'Other';
    const entry = byCategory.get(key) ?? { count: 0, ages: new Set<string>() };
    entry.count++;
    if (r.ageRange) entry.ages.add(r.ageRange);
    byCategory.set(key, entry);
  }

  // Preserve the authored offer order, then append any family-authored categories.
  const order = [...new Set(SYSTEM_TEMPLATES.map((t) => t.category))];
  const sorted = [...byCategory.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return sorted.map((category) => ({
    category,
    templateCount: byCategory.get(category)!.count,
    ageRanges: [...byCategory.get(category)!.ages].sort(),
  }));
}

/** How many more assignments this child can take right now (CR-10). */
async function remainingCapacity(childId: string): Promise<number> {
  const active = await prisma.taskAssignment.count({
    where: {
      childId,
      status: { in: ['pending', 'in_progress'] },
      task: { status: { not: 'archived' } },
    },
  });
  return Math.max(0, MAX_ACTIVE_TOTAL - active);
}

/**
 * Create one task per template in a pack, atomically.
 *
 * All-or-nothing: a partial failure creates nothing, so a parent never ends up with half a pack and
 * no idea which half. Tasks are created as `secondary` — a chore pack is optional/bonus work, not
 * the day's single primary task, and only `secondary` can have more than one active at a time.
 */
export async function applyPack(params: {
  familyId: string;
  createdBy: string;
  category: string;
  childId?: string;
}): Promise<ApplyPackResult> {
  const { familyId, createdBy, category, childId } = params;

  const templates = await prisma.taskTemplate.findMany({
    where: { category, OR: [{ isSystemTemplate: true }, { familyId }] },
    orderBy: { name: 'asc' },
  });
  if (templates.length === 0) throw new NotFoundError(`No templates found in pack "${category}"`);

  let child: { id: string; dateOfBirth: Date | null } | null = null;
  if (childId) {
    const found = await prisma.user.findFirst({
      where: { id: childId, familyId, role: 'child', deletedAt: null },
      include: { childProfile: { select: { dateOfBirth: true } } },
    });
    if (!found) throw new NotFoundError('Child not found');
    child = { id: found.id, dateOfBirth: found.childProfile?.dateOfBirth ?? null };
  }

  // Only offer a child what suits their age; the library still gets the whole pack.
  const assignable = child
    ? templates.filter((t) => isAgeAppropriate(t.ageRange, child!.dateOfBirth))
    : [];

  const capacity = child ? await remainingCapacity(child.id) : 0;
  const toAssign = assignable.slice(0, capacity).map((t) => t.id);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await prisma.$transaction(async (tx) => {
    let assigned = 0;

    for (const t of templates) {
      const task = await tx.task.create({
        data: {
          familyId,
          createdBy,
          templateId: t.id,
          title: t.name,
          description: t.description,
          category: t.category,
          difficulty: (t.difficulty ?? 'easy') as 'easy' | 'medium' | 'hard',
          pointsValue: t.suggestedPoints,
          estimatedMinutes: t.estimatedMinutes,
          requiresPhotoEvidence: t.requiresPhotoEvidence,
          taskTag: 'secondary',
        },
      });

      if (child && toAssign.includes(t.id)) {
        await tx.taskAssignment.create({
          data: { taskId: task.id, childId: child.id, instanceDate: today },
        });
        assigned++;
      }
    }

    return { created: templates.length, assigned };
  });

  const skippedForCapacity = child ? Math.max(0, assignable.length - result.assigned) : 0;

  return {
    category,
    created: result.created,
    assigned: result.assigned,
    skippedForCapacity,
    message: buildMessage(result.created, result.assigned, skippedForCapacity, Boolean(child)),
  };
}

/** Says plainly what happened, including what was held back and why. */
function buildMessage(created: number, assigned: number, skipped: number, hasChild: boolean): string {
  const base = `Added ${created} task${created === 1 ? '' : 's'} to your library.`;
  if (!hasChild) return `${base} Assign them to a child when they're ready.`;
  if (skipped === 0) return `${base} ${assigned} assigned.`;
  return (
    `${base} ${assigned} assigned — the other ${skipped} are waiting, because a child can have ` +
    `${MAX_ACTIVE_TOTAL} active tasks at a time.`
  );
}

/** A single template, resolved for pre-filling the create-task form (AC-U2d: edit before submit). */
export async function getTemplate(familyId: string, templateId: string): Promise<TemplateRow> {
  const t = await prisma.taskTemplate.findFirst({
    where: { id: templateId, OR: [{ isSystemTemplate: true }, { familyId }] },
  });
  if (!t) throw new NotFoundError('Template not found');
  if (!t.name) throw new ValidationError('Template is malformed');

  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    difficulty: t.difficulty,
    suggestedPoints: t.suggestedPoints,
    estimatedMinutes: t.estimatedMinutes,
    ageRange: t.ageRange,
    requiresPhotoEvidence: t.requiresPhotoEvidence,
    isSystemTemplate: t.isSystemTemplate,
  };
}

export const TemplateService = { listTemplates, listPacks, applyPack, getTemplate };

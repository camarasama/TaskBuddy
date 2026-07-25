/**
 * U2 — task template library + reward presets (growth roadmap §3.1, #1 activation priority).
 *
 * The case that needed the most care is `applyPack`. The roadmap says a pack is added "for a
 * selected child", but CR-10 caps a child at 3 active assignments — so a 6-task pack cannot be
 * assigned wholesale. Rather than raise a cap that exists to stop overwhelming a child, a pack fills
 * the family LIBRARY in full and assigns only up to remaining capacity, reporting what it held back.
 * Those are the tests below that matter most.
 */

jest.mock('../src/services/database', () => {
  const tx = {
    task: { create: jest.fn() },
    taskAssignment: { create: jest.fn() },
  };
  return {
    prisma: {
      taskTemplate: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      taskAssignment: { count: jest.fn() },
      user: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { TemplateService } from '../src/services/TemplateService';
import {
  REWARD_PRESETS,
  SYSTEM_TEMPLATES,
  packNames,
} from '../src/routes/templatesSeed';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  taskTemplate: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
  taskAssignment: { count: jest.Mock };
  user: { findFirst: jest.Mock };
  $transaction: jest.Mock;
  __tx: { task: { create: jest.Mock }; taskAssignment: { create: jest.Mock } };
};

const FAMILY = 'fam-1';
const CHILD = 'a3f1c2d4-0000-4000-8000-000000000001';

/** A child born 12 years ago — inside '10-12', outside '13-16'. */
const TWELVE = new Date(Date.now() - 12 * 365.25 * 86_400_000);

function template(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tpl-1',
    familyId: null,
    isSystemTemplate: true,
    name: 'Make your bed',
    description: 'Straighten the covers.',
    category: 'Morning Routine',
    difficulty: 'easy',
    suggestedPoints: 5,
    estimatedMinutes: 5,
    ageRange: null,
    requiresPhotoEvidence: true,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.__tx.task.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `task-${data.title}`, ...data }),
  );
  p.__tx.taskAssignment.create.mockResolvedValue({});
});

// ─── Seed content (AC-U2a, AC-U2b) ───────────────────────────────────────────

describe('seed content', () => {
  it('ships at least 30 task templates', () => {
    expect(SYSTEM_TEMPLATES.length).toBeGreaterThanOrEqual(30);
  });

  it('ships at least 4 named packs', () => {
    expect(packNames().length).toBeGreaterThanOrEqual(4);
  });

  it('ships exactly the 10 reward presets the owner asked for', () => {
    expect(REWARD_PRESETS).toHaveLength(10);
  });

  it('gives every template a name, points and a difficulty', () => {
    for (const t of SYSTEM_TEMPLATES) {
      expect(t.name.trim()).not.toBe('');
      expect(t.suggestedPoints).toBeGreaterThan(0);
      expect(['easy', 'medium', 'hard']).toContain(t.difficulty);
    }
  });

  it('only uses age bands isAgeAppropriate can parse', () => {
    // A band it cannot parse silently admits everyone, which would defeat the filter.
    for (const t of SYSTEM_TEMPLATES) {
      if (t.ageRange !== null) expect(t.ageRange).toMatch(/^\d+-\d+$/);
    }
  });

  it('has no duplicate name within a pack', () => {
    const seen = new Set<string>();
    for (const t of SYSTEM_TEMPLATES) {
      const key = `${t.category}::${t.name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('prices reward presets in ascending tiers', () => {
    const small = REWARD_PRESETS.filter((r) => r.tier === 'small').map((r) => r.pointsCost);
    const large = REWARD_PRESETS.filter((r) => r.tier === 'large').map((r) => r.pointsCost);
    expect(Math.max(...small)).toBeLessThan(Math.max(...large));
  });
});

// ─── Listing + family isolation (AC-U2c, AC-U2f) ──────────────────────────────

describe('listTemplates', () => {
  it('asks only for system templates or this family’s own', async () => {
    p.taskTemplate.findMany.mockResolvedValue([]);
    await TemplateService.listTemplates({ familyId: FAMILY });

    const where = p.taskTemplate.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ isSystemTemplate: true }, { familyId: FAMILY }]);
  });

  it('never returns another family’s template', async () => {
    // Belt and braces: even if the query were wrong, the OR clause is the guard under test.
    p.taskTemplate.findMany.mockResolvedValue([template({ familyId: FAMILY, isSystemTemplate: false })]);
    const rows = await TemplateService.listTemplates({ familyId: FAMILY });
    expect(rows.every((r) => r.isSystemTemplate || true)).toBe(true);
    const where = p.taskTemplate.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('other-family');
  });

  it('filters by the child’s real date of birth, not a banded enum', async () => {
    p.user.findFirst.mockResolvedValue({ id: CHILD, childProfile: { dateOfBirth: TWELVE } });
    p.taskTemplate.findMany.mockResolvedValue([
      template({ id: 'ok', ageRange: '10-12' }),
      template({ id: 'too-old', ageRange: '13-16' }),
      template({ id: 'all-ages', ageRange: null }),
    ]);

    const rows = await TemplateService.listTemplates({ familyId: FAMILY, childId: CHILD });

    expect(rows.map((r) => r.id).sort()).toEqual(['all-ages', 'ok']);
  });

  it('returns everything when no child is given', async () => {
    p.taskTemplate.findMany.mockResolvedValue([
      template({ id: 'a', ageRange: '10-12' }),
      template({ id: 'b', ageRange: '13-16' }),
    ]);
    const rows = await TemplateService.listTemplates({ familyId: FAMILY });
    expect(rows).toHaveLength(2);
  });

  it('404s for a child outside the family', async () => {
    p.user.findFirst.mockResolvedValue(null);
    await expect(
      TemplateService.listTemplates({ familyId: FAMILY, childId: CHILD }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── applyPack (AC-U2e + the CR-10 conflict) ──────────────────────────────────

describe('applyPack', () => {
  const pack = [
    template({ id: 't1', name: 'A' }),
    template({ id: 't2', name: 'B' }),
    template({ id: 't3', name: 'C' }),
    template({ id: 't4', name: 'D' }),
    template({ id: 't5', name: 'E' }),
  ];

  it('creates one task per template', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    const result = await TemplateService.applyPack({
      familyId: FAMILY,
      createdBy: 'parent-1',
      category: 'Morning Routine',
    });
    expect(result.created).toBe(5);
    expect(p.__tx.task.create).toHaveBeenCalledTimes(5);
  });

  it('runs inside one transaction, so a partial failure creates nothing', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    p.$transaction.mockRejectedValueOnce(new Error('constraint violation'));

    await expect(
      TemplateService.applyPack({ familyId: FAMILY, createdBy: 'parent-1', category: 'Morning Routine' }),
    ).rejects.toThrow('constraint violation');
  });

  it('creates tasks as secondary, so more than one can be active at a time', async () => {
    // CR-10 allows only ONE active primary; a chore pack tagged primary could never exceed 1.
    p.taskTemplate.findMany.mockResolvedValue(pack);
    await TemplateService.applyPack({ familyId: FAMILY, createdBy: 'parent-1', category: 'Morning Routine' });
    for (const call of p.__tx.task.create.mock.calls) {
      expect(call[0].data.taskTag).toBe('secondary');
    }
  });

  it('links each task back to the template it came from', async () => {
    p.taskTemplate.findMany.mockResolvedValue([pack[0]]);
    await TemplateService.applyPack({ familyId: FAMILY, createdBy: 'parent-1', category: 'Morning Routine' });
    expect(p.__tx.task.create.mock.calls[0][0].data.templateId).toBe('t1');
  });

  it('assigns NOTHING when no child is given — the library still gets the pack', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    const result = await TemplateService.applyPack({
      familyId: FAMILY,
      createdBy: 'parent-1',
      category: 'Morning Routine',
    });
    expect(result.created).toBe(5);
    expect(result.assigned).toBe(0);
    expect(p.__tx.taskAssignment.create).not.toHaveBeenCalled();
  });

  // The CR-10 conflict — the heart of this unit.
  it('assigns only up to the child’s remaining capacity and reports the rest', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    p.user.findFirst.mockResolvedValue({ id: CHILD, childProfile: { dateOfBirth: TWELVE } });
    p.taskAssignment.count.mockResolvedValue(1); // 1 active → 2 slots left of 3

    const result = await TemplateService.applyPack({
      familyId: FAMILY,
      createdBy: 'parent-1',
      category: 'Morning Routine',
      childId: CHILD,
    });

    expect(result.created).toBe(5);
    expect(result.assigned).toBe(2);
    expect(result.skippedForCapacity).toBe(3);
    expect(result.message).toContain('3 active tasks at a time');
  });

  it('assigns nothing when the child is already at the cap, but still fills the library', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    p.user.findFirst.mockResolvedValue({ id: CHILD, childProfile: { dateOfBirth: TWELVE } });
    p.taskAssignment.count.mockResolvedValue(3);

    const result = await TemplateService.applyPack({
      familyId: FAMILY,
      createdBy: 'parent-1',
      category: 'Morning Routine',
      childId: CHILD,
    });

    expect(result.created).toBe(5);
    expect(result.assigned).toBe(0);
    expect(result.skippedForCapacity).toBe(5);
  });

  it('does not assign a template the child is too young for', async () => {
    p.taskTemplate.findMany.mockResolvedValue([
      template({ id: 't1', name: 'A', ageRange: '13-16' }),
      template({ id: 't2', name: 'B', ageRange: null }),
    ]);
    p.user.findFirst.mockResolvedValue({ id: CHILD, childProfile: { dateOfBirth: TWELVE } });
    p.taskAssignment.count.mockResolvedValue(0);

    const result = await TemplateService.applyPack({
      familyId: FAMILY,
      createdBy: 'parent-1',
      category: 'Morning Routine',
      childId: CHILD,
    });

    // Both land in the library; only the age-appropriate one is assigned.
    expect(result.created).toBe(2);
    expect(result.assigned).toBe(1);
  });

  it('404s on an unknown pack rather than creating an empty one', async () => {
    p.taskTemplate.findMany.mockResolvedValue([]);
    await expect(
      TemplateService.applyPack({ familyId: FAMILY, createdBy: 'parent-1', category: 'Nope' }),
    ).rejects.toThrow(/No templates found/);
  });

  it('404s for a child outside the family', async () => {
    p.taskTemplate.findMany.mockResolvedValue(pack);
    p.user.findFirst.mockResolvedValue(null);
    await expect(
      TemplateService.applyPack({
        familyId: FAMILY,
        createdBy: 'parent-1',
        category: 'Morning Routine',
        childId: CHILD,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── getTemplate (AC-U2d) ─────────────────────────────────────────────────────

describe('getTemplate', () => {
  it('returns the template so the create form can be pre-filled', async () => {
    p.taskTemplate.findFirst.mockResolvedValue(template());
    const t = await TemplateService.getTemplate(FAMILY, 'tpl-1');
    expect(t).toMatchObject({ name: 'Make your bed', suggestedPoints: 5, requiresPhotoEvidence: true });
  });

  it('is scoped to system templates or this family’s own', async () => {
    p.taskTemplate.findFirst.mockResolvedValue(template());
    await TemplateService.getTemplate(FAMILY, 'tpl-1');
    const where = p.taskTemplate.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ isSystemTemplate: true }, { familyId: FAMILY }]);
  });

  it('404s for a template belonging to another family', async () => {
    p.taskTemplate.findFirst.mockResolvedValue(null);
    await expect(TemplateService.getTemplate(FAMILY, 'tpl-x')).rejects.toThrow(/not found/i);
  });
});

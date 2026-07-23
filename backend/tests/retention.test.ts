jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findMany: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
    taskEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    emailLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));
jest.mock('../src/services/storage', () => ({ deleteFile: jest.fn().mockResolvedValue(undefined) }));

import { RetentionService } from '../src/services/RetentionService';
import { prisma } from '../src/services/database';
import { deleteFile } from '../src/services/storage';
import { config } from '../src/config';

const familyFindMany = prisma.family.findMany as jest.Mock;
const familyDelete = prisma.family.delete as jest.Mock;
const evidenceFindMany = prisma.taskEvidence.findMany as jest.Mock;
const auditRedact = prisma.auditLog.updateMany as jest.Mock;
const emailRedact = prisma.emailLog.updateMany as jest.Mock;
const setPurge = (on: boolean) => { (config.retention as { purgeEnabled: boolean }).purgeEnabled = on; };

describe('RetentionService — GDPR-K hard delete (Phase 7)', () => {
  beforeEach(() => jest.clearAllMocks());
  afterAll(() => setPurge(false));

  it('queries by the retention cutoff (only soft-deleted families past the window)', async () => {
    setPurge(false);
    familyFindMany.mockResolvedValue([]);
    await RetentionService.runRetention(new Date('2026-07-23T00:00:00Z'));
    const where = familyFindMany.mock.calls[0][0].where;
    expect(where.deletedAt.not).toBeNull();
    expect(where.deletedAt.lt).toBeInstanceOf(Date); // now - retention days
  });

  it('DRY RUN when disabled: finds expired families but deletes NOTHING', async () => {
    setPurge(false);
    familyFindMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);

    const result = await RetentionService.runRetention(new Date());

    expect(result).toEqual({ enabled: false, families: 2, purged: 0 });
    expect(familyDelete).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(auditRedact).not.toHaveBeenCalled();
  });

  it('when enabled: deletes evidence from R2, redacts logs, then hard-deletes the family', async () => {
    setPurge(true);
    familyFindMany.mockResolvedValue([{ id: 'f1' }]);
    evidenceFindMany.mockResolvedValue([{ fileKey: 'evidence/x.jpg', thumbnailKey: 'evidence/x_thumb.jpg' }]);

    const result = await RetentionService.runRetention(new Date());

    expect(result).toEqual({ enabled: true, families: 1, purged: 1 });
    expect(deleteFile).toHaveBeenCalledWith('evidence/x.jpg', 'evidence/x_thumb.jpg', { kind: 'evidence' });
    // Logs are REDACTED (kept), never deleted.
    expect(auditRedact).toHaveBeenCalledWith({ where: { familyId: 'f1' }, data: { metadata: { redacted: true } } });
    expect(emailRedact).toHaveBeenCalledWith({ where: { familyId: 'f1' }, data: { toEmail: '[redacted]' } });
    expect(familyDelete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });

  it('no expired families → no-op', async () => {
    setPurge(true);
    familyFindMany.mockResolvedValue([]);
    const result = await RetentionService.runRetention(new Date());
    expect(result.families).toBe(0);
    expect(familyDelete).not.toHaveBeenCalled();
  });

  it('one family failing does not abort the rest', async () => {
    setPurge(true);
    familyFindMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
    familyDelete.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    const result = await RetentionService.runRetention(new Date());
    expect(result.families).toBe(2);
    expect(result.purged).toBe(1); // 'good' still purged despite 'bad' throwing
  });
});

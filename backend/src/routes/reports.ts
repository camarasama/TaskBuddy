/**
 * reports.ts — M10 Phase 4 (updated: PDF for all 10 reports)
 *
 * Routes (all under /api/v1/reports):
 *   GET /task-completion, /points-ledger, /reward-redemption,
 *       /engagement-streak, /achievement, /leaderboard,
 *       /expiry-overdue, /platform-health, /audit-trail, /email-delivery
 *
 *   GET /:name/export?format=csv|pdf
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTaskCompletionReport, getPointsLedgerReport, getRewardRedemptionReport,
  getEngagementStreakReport, getAchievementReport, getLeaderboardReport,
  getExpiryOverdueReport, getPlatformHealthReport, getAuditTrailReport,
  getEmailDeliveryReport, ReportFilters,
} from '../services/ReportService';
import {
  exportTaskCompletionCsv, exportPointsLedgerCsv, exportRewardRedemptionCsv,
  exportEngagementStreakCsv, exportAchievementCsv, exportLeaderboardCsv,
  exportExpiryOverdueCsv, exportPlatformHealthCsv, exportAuditTrailCsv, exportEmailDeliveryCsv,
  exportTaskCompletionPdf, exportPointsLedgerPdf, exportRewardRedemptionPdf,
  exportEngagementStreakPdf, exportAchievementPdf, exportLeaderboardPdf,
  exportExpiryOverduePdf, exportPlatformHealthPdf, exportAuditTrailPdf, exportEmailDeliveryPdf,
} from '../services/ExportService';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

function buildFilters(req: Request): ReportFilters {
  const user = (req as any).user as { id: string; familyId?: string; role: string };
  const familyId = user.role === 'admin' && req.query.familyId
    ? (req.query.familyId as string)
    : user.familyId;
  return {
    familyId,
    childId: req.query.childId as string | undefined,
    startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
    endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
  };
}

// ─── Report data endpoints ────────────────────────────────────────────────────

reportsRouter.get('/task-completion', async (req, res) => {
  try { res.json(await getTaskCompletionReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/points-ledger', async (req, res) => {
  try { res.json(await getPointsLedgerReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/reward-redemption', async (req, res) => {
  try { res.json(await getRewardRedemptionReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/engagement-streak', async (req, res) => {
  try { res.json(await getEngagementStreakReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/achievement', async (req, res) => {
  try { res.json(await getAchievementReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/leaderboard', async (req, res) => {
  try {
    const user = (req as any).user as { familyId?: string; role: string };
    const familyId = user.role === 'admin' && req.query.familyId ? (req.query.familyId as string) : user.familyId;
    if (!familyId) { res.status(400).json({ error: 'familyId required' }); return; }
    const period = (req.query.period as 'weekly' | 'monthly' | 'all-time') ?? 'weekly';
    res.json(await getLeaderboardReport(familyId, period));
  } catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/expiry-overdue', async (req, res) => {
  try { res.json(await getExpiryOverdueReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/platform-health', async (req, res) => {
  const user = (req as any).user as { role: string };
  if (user.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  try { res.json(await getPlatformHealthReport()); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/audit-trail', async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const pageSize = parseInt((req.query.pageSize as string) ?? '100', 10);
    res.json(await getAuditTrailReport(buildFilters(req), page, pageSize));
  } catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

reportsRouter.get('/email-delivery', async (req, res) => {
  try { res.json(await getEmailDeliveryReport(buildFilters(req))); }
  catch (err) { res.status(500).json({ error: 'Failed', detail: String(err) }); }
});

// ─── Export: GET /:name/export?format=csv|pdf ─────────────────────────────────

// All 10 reports now support both CSV and PDF
const ALL_REPORTS = [
  'task-completion', 'points-ledger', 'reward-redemption', 'engagement-streak',
  'achievement', 'leaderboard', 'expiry-overdue', 'platform-health',
  'audit-trail', 'email-delivery',
] as const;

type ReportName = typeof ALL_REPORTS[number];

reportsRouter.get('/:name/export', async (req: Request, res: Response) => {
  const name = req.params.name as ReportName;
  const format = ((req.query.format as string) ?? 'csv').toLowerCase();

  if (!['csv', 'pdf'].includes(format)) {
    res.status(400).json({ error: 'format must be csv or pdf' }); return;
  }
  if (!ALL_REPORTS.includes(name)) {
    res.status(404).json({ error: `Unknown report: ${name}` }); return;
  }

  const user = (req as any).user as { id: string; familyId?: string; role: string };

  // platform-health is admin-only
  if (name === 'platform-health' && user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' }); return;
  }

  try {
    const filters = buildFilters(req);
    const date = new Date().toISOString().split('T')[0];
    let buffer: Buffer;
    const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv';
    const filename = `taskbuddy-${name}-${date}.${format}`;

    if (format === 'csv') {
      switch (name) {
        case 'task-completion':    buffer = await exportTaskCompletionCsv(await getTaskCompletionReport(filters)); break;
        case 'points-ledger':      buffer = await exportPointsLedgerCsv(await getPointsLedgerReport(filters)); break;
        case 'reward-redemption':  buffer = await exportRewardRedemptionCsv(await getRewardRedemptionReport(filters)); break;
        case 'engagement-streak':  buffer = await exportEngagementStreakCsv(await getEngagementStreakReport(filters)); break;
        case 'achievement':        buffer = await exportAchievementCsv(await getAchievementReport(filters)); break;
        case 'leaderboard': {
          const familyId = user.role === 'admin' && req.query.familyId ? (req.query.familyId as string) : user.familyId;
          if (!familyId) { res.status(400).json({ error: 'familyId required' }); return; }
          buffer = await exportLeaderboardCsv(await getLeaderboardReport(familyId, (req.query.period as any) ?? 'weekly')); break;
        }
        case 'expiry-overdue':    buffer = await exportExpiryOverdueCsv(await getExpiryOverdueReport(filters)); break;
        case 'platform-health':   buffer = await exportPlatformHealthCsv(await getPlatformHealthReport()); break;
        case 'audit-trail': {
          const page = parseInt((req.query.page as string) ?? '1', 10);
          buffer = await exportAuditTrailCsv(await getAuditTrailReport(filters, page, 10000)); break;
        }
        case 'email-delivery':    buffer = await exportEmailDeliveryCsv(await getEmailDeliveryReport(filters)); break;
        default: res.status(404).json({ error: `Unknown report: ${name}` }); return;
      }
    } else {
      // PDF
      switch (name) {
        case 'task-completion':   buffer = await exportTaskCompletionPdf(await getTaskCompletionReport(filters)); break;
        case 'points-ledger':     buffer = await exportPointsLedgerPdf(await getPointsLedgerReport(filters)); break;
        case 'reward-redemption': buffer = await exportRewardRedemptionPdf(await getRewardRedemptionReport(filters)); break;
        case 'engagement-streak': buffer = await exportEngagementStreakPdf(await getEngagementStreakReport(filters)); break;
        case 'achievement':       buffer = await exportAchievementPdf(await getAchievementReport(filters)); break;
        case 'leaderboard': {
          const familyId = user.role === 'admin' && req.query.familyId ? (req.query.familyId as string) : user.familyId;
          if (!familyId) { res.status(400).json({ error: 'familyId required' }); return; }
          buffer = await exportLeaderboardPdf(await getLeaderboardReport(familyId, (req.query.period as any) ?? 'weekly')); break;
        }
        case 'expiry-overdue':    buffer = await exportExpiryOverduePdf(await getExpiryOverdueReport(filters)); break;
        case 'platform-health':   buffer = await exportPlatformHealthPdf(await getPlatformHealthReport()); break;
        case 'audit-trail': {
          const page = parseInt((req.query.page as string) ?? '1', 10);
          buffer = await exportAuditTrailPdf(await getAuditTrailReport(filters, page, 1000)); break;
        }
        case 'email-delivery':    buffer = await exportEmailDeliveryPdf(await getEmailDeliveryReport(filters)); break;
        default: res.status(404).json({ error: `Unknown report: ${name}` }); return;
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', detail: String(err) });
  }
});
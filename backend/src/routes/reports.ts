/**
 * reports.ts — M10 Phase 4
 *
 * All 10 report endpoints + CSV / PDF export.
 *
 * Routes (all under /api/v1/reports):
 *
 *   GET /task-completion          R-01
 *   GET /points-ledger            R-02
 *   GET /reward-redemption        R-03
 *   GET /engagement-streak        R-04
 *   GET /achievement              R-05
 *   GET /leaderboard              R-06
 *   GET /expiry-overdue           R-07
 *   GET /platform-health          R-08  (admin only)
 *   GET /audit-trail              R-09
 *   GET /email-delivery           R-10
 *
 *   GET /:name/export?format=csv|pdf
 *
 * Query params (all optional):
 *   childId    — filter to one child
 *   startDate  — ISO date string
 *   endDate    — ISO date string
 *   period     — weekly | monthly | all-time  (leaderboard only)
 *   page       — page number (audit trail only, default 1)
 *   pageSize   — (audit trail only, default 100)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTaskCompletionReport,
  getPointsLedgerReport,
  getRewardRedemptionReport,
  getEngagementStreakReport,
  getAchievementReport,
  getLeaderboardReport,
  getExpiryOverdueReport,
  getPlatformHealthReport,
  getAuditTrailReport,
  getEmailDeliveryReport,
  ReportFilters,
} from '../services/ReportService';
import {
  exportTaskCompletionCsv,
  exportPointsLedgerCsv,
  exportRewardRedemptionCsv,
  exportEngagementStreakCsv,
  exportAchievementCsv,
  exportLeaderboardCsv,
  exportExpiryOverdueCsv,
  exportPlatformHealthCsv,
  exportAuditTrailCsv,
  exportEmailDeliveryCsv,
  exportTaskCompletionPdf,
  exportLeaderboardPdf,
  exportPlatformHealthPdf,
} from '../services/ExportService';

export const reportsRouter = Router();

// ─── Auth guard: all report routes require a valid JWT ────────────────────────
reportsRouter.use(authenticate);

// ─── Helper: build filters from query string ──────────────────────────────────

function buildFilters(req: Request): ReportFilters {
  const user = (req as any).user as { id: string; familyId?: string; role: string };
  const { childId, startDate, endDate } = req.query as Record<string, string>;

  const filters: ReportFilters = {};

  // Admins can see all data unless they pass a familyId; parents are scoped to their family
  if (user.role === 'admin') {
    if (req.query.familyId) filters.familyId = req.query.familyId as string;
  } else {
    filters.familyId = user.familyId;
  }

  if (childId) filters.childId = childId;
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);

  return filters;
}

// ─── Guard: admin only ────────────────────────────────────────────────────────

function adminOnly(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as { role: string };
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ─── R-01: Task Completion ────────────────────────────────────────────────────

reportsRouter.get('/task-completion', async (req: Request, res: Response) => {
  try {
    const data = await getTaskCompletionReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate task completion report', detail: String(err) });
  }
});

// ─── R-02: Points / XP Ledger ─────────────────────────────────────────────────

reportsRouter.get('/points-ledger', async (req: Request, res: Response) => {
  try {
    const data = await getPointsLedgerReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate points ledger report', detail: String(err) });
  }
});

// ─── R-03: Reward Redemption ──────────────────────────────────────────────────

reportsRouter.get('/reward-redemption', async (req: Request, res: Response) => {
  try {
    const data = await getRewardRedemptionReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate reward redemption report', detail: String(err) });
  }
});

// ─── R-04: Engagement & Streak ────────────────────────────────────────────────

reportsRouter.get('/engagement-streak', async (req: Request, res: Response) => {
  try {
    const data = await getEngagementStreakReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate engagement report', detail: String(err) });
  }
});

// ─── R-05: Achievement & Level Progression ────────────────────────────────────

reportsRouter.get('/achievement', async (req: Request, res: Response) => {
  try {
    const data = await getAchievementReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate achievement report', detail: String(err) });
  }
});

// ─── R-06: Family Leaderboard ─────────────────────────────────────────────────

reportsRouter.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as { familyId?: string; role: string };
    const familyId =
      user.role === 'admin' && req.query.familyId
        ? (req.query.familyId as string)
        : user.familyId;

    if (!familyId) {
      res.status(400).json({ error: 'familyId required' });
      return;
    }

    const period = (req.query.period as 'weekly' | 'monthly' | 'all-time') ?? 'weekly';
    const data = await getLeaderboardReport(familyId, period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate leaderboard report', detail: String(err) });
  }
});

// ─── R-07: Task Expiry & Overdue ──────────────────────────────────────────────

reportsRouter.get('/expiry-overdue', async (req: Request, res: Response) => {
  try {
    const data = await getExpiryOverdueReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate expiry report', detail: String(err) });
  }
});

// ─── R-08: Admin Platform Health (admin only) ─────────────────────────────────

reportsRouter.get('/platform-health', adminOnly, async (_req: Request, res: Response) => {
  try {
    const data = await getPlatformHealthReport();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate platform health report', detail: String(err) });
  }
});

// ─── R-09: Audit Trail ────────────────────────────────────────────────────────

reportsRouter.get('/audit-trail', async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const pageSize = parseInt((req.query.pageSize as string) ?? '100', 10);
    const data = await getAuditTrailReport(buildFilters(req), page, pageSize);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate audit trail report', detail: String(err) });
  }
});

// ─── R-10: Email Delivery ─────────────────────────────────────────────────────

reportsRouter.get('/email-delivery', async (req: Request, res: Response) => {
  try {
    const data = await getEmailDeliveryReport(buildFilters(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate email delivery report', detail: String(err) });
  }
});

// ─── Export: GET /:name/export?format=csv|pdf ─────────────────────────────────

const PDF_REPORTS = ['task-completion', 'leaderboard', 'platform-health'] as const;

reportsRouter.get('/:name/export', async (req: Request, res: Response) => {
  const { name } = req.params;
  const format = (req.query.format as string)?.toLowerCase() ?? 'csv';

  if (!['csv', 'pdf'].includes(format)) {
    res.status(400).json({ error: 'format must be csv or pdf' });
    return;
  }

  if (format === 'pdf' && !PDF_REPORTS.includes(name as (typeof PDF_REPORTS)[number])) {
    res.status(400).json({ error: `PDF export is only available for: ${PDF_REPORTS.join(', ')}` });
    return;
  }

  try {
    const filters = buildFilters(req);
    let buffer: Buffer;
    let contentType: string;
    let filename: string;

    if (format === 'csv') {
      contentType = 'text/csv';
      filename = `taskbuddy-${name}-${new Date().toISOString().split('T')[0]}.csv`;

      switch (name) {
        case 'task-completion':
          buffer = await exportTaskCompletionCsv(await getTaskCompletionReport(filters)); break;
        case 'points-ledger':
          buffer = await exportPointsLedgerCsv(await getPointsLedgerReport(filters)); break;
        case 'reward-redemption':
          buffer = await exportRewardRedemptionCsv(await getRewardRedemptionReport(filters)); break;
        case 'engagement-streak':
          buffer = await exportEngagementStreakCsv(await getEngagementStreakReport(filters)); break;
        case 'achievement':
          buffer = await exportAchievementCsv(await getAchievementReport(filters)); break;
        case 'leaderboard': {
          const user = (req as any).user as { familyId?: string; role: string };
          const familyId = user.role === 'admin' && req.query.familyId
            ? (req.query.familyId as string) : user.familyId;
          if (!familyId) { res.status(400).json({ error: 'familyId required' }); return; }
          const period = (req.query.period as 'weekly' | 'monthly' | 'all-time') ?? 'weekly';
          buffer = await exportLeaderboardCsv(await getLeaderboardReport(familyId, period)); break;
        }
        case 'expiry-overdue':
          buffer = await exportExpiryOverdueCsv(await getExpiryOverdueReport(filters)); break;
        case 'platform-health': {
          const user = (req as any).user as { role: string };
          if (user.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
          buffer = await exportPlatformHealthCsv(await getPlatformHealthReport()); break;
        }
        case 'audit-trail': {
          const page = parseInt((req.query.page as string) ?? '1', 10);
          buffer = await exportAuditTrailCsv(await getAuditTrailReport(filters, page, 10000)); break;
        }
        case 'email-delivery':
          buffer = await exportEmailDeliveryCsv(await getEmailDeliveryReport(filters)); break;
        default:
          res.status(404).json({ error: `Unknown report: ${name}` }); return;
      }
    } else {
      // PDF
      contentType = 'application/pdf';
      filename = `taskbuddy-${name}-${new Date().toISOString().split('T')[0]}.pdf`;

      switch (name) {
        case 'task-completion':
          buffer = await exportTaskCompletionPdf(await getTaskCompletionReport(filters)); break;
        case 'leaderboard': {
          const user = (req as any).user as { familyId?: string; role: string };
          const familyId = user.role === 'admin' && req.query.familyId
            ? (req.query.familyId as string) : user.familyId;
          if (!familyId) { res.status(400).json({ error: 'familyId required' }); return; }
          const period = (req.query.period as 'weekly' | 'monthly' | 'all-time') ?? 'weekly';
          buffer = await exportLeaderboardPdf(await getLeaderboardReport(familyId, period)); break;
        }
        case 'platform-health': {
          const user = (req as any).user as { role: string };
          if (user.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
          buffer = await exportPlatformHealthPdf(await getPlatformHealthReport()); break;
        }
        default:
          res.status(400).json({ error: `PDF not available for ${name}` }); return;
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

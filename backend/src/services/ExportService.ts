/**
 * ExportService — M10 Phase 4
 *
 * Converts report data returned by ReportService into
 * downloadable CSV or PDF buffers.
 *
 * CSV  — all 10 reports via fast-csv
 * PDF  — R-01, R-06, R-08 via pdf-lib
 *
 * Install deps:
 *   npm install fast-csv pdf-lib
 *   npm install -D @types/fast-csv
 */

import { format as formatCsv } from '@fast-csv/format';
import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { Writable, PassThrough } from 'stream';
import type {
  TaskCompletionReport,
  LedgerReport,
  RedemptionReport,
  EngagementReport,
  AchievementReport,
  LeaderboardReport,
  ExpiryReport,
  PlatformHealthReport,
  AuditTrailReport,
  EmailDeliveryReport,
} from './ReportService';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/** Streams an array of row objects into a CSV Buffer. */
async function rowsToCsvBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);

    const csvStream = formatCsv({ headers: true });
    csvStream.pipe(passThrough);

    for (const row of rows) csvStream.write(row);
    csvStream.end();
  });
}

// ─── CSV exports (all 10) ─────────────────────────────────────────────────────

export async function exportTaskCompletionCsv(report: TaskCompletionReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Date: r.date,
      Child: r.childName,
      Task: r.taskTitle,
      Tag: r.taskTag,
      Difficulty: r.difficulty ?? '',
      'Points Awarded': r.pointsAwarded,
      'XP Awarded': r.xpAwarded,
      'Completed At': r.completedAt,
      'Approved At': r.approvedAt ?? '',
    }))
  );
}

export async function exportPointsLedgerCsv(report: LedgerReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Date: r.date,
      Child: r.childName,
      'Transaction Type': r.transactionType,
      'Points Amount': r.pointsAmount,
      'Balance After': r.balanceAfter,
      Reference: r.referenceType ?? '',
      Description: r.description ?? '',
    }))
  );
}

export async function exportRewardRedemptionCsv(report: RedemptionReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Date: r.date,
      Child: r.childName,
      Reward: r.rewardName,
      Tier: r.rewardTier ?? '',
      'Points Spent': r.pointsSpent,
      Status: r.status,
      'Fulfilled At': r.fulfilledAt ?? '',
    }))
  );
}

export async function exportEngagementStreakCsv(report: EngagementReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Child: r.childName,
      'Current Streak': r.currentStreak,
      'Longest Streak': r.longestStreak,
      'Total Tasks Completed': r.totalTasksCompleted,
      'Last Activity Date': r.lastActivityDate ?? '',
      'Primary Adherence %': r.primaryAdherenceRate,
    }))
  );
}

export async function exportAchievementCsv(report: AchievementReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Child: r.childName,
      Level: r.currentLevel,
      'XP (Current)': r.experiencePoints,
      'Total XP Earned': r.totalXpEarned,
      'Achievements Unlocked': r.achievementsUnlocked,
      'Latest Achievement': r.latestAchievementName ?? '',
      Tier: r.latestAchievementTier ?? '',
      'Unlocked At': r.latestUnlockedAt ?? '',
    }))
  );
}

export async function exportLeaderboardCsv(report: LeaderboardReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Rank: r.rank,
      Child: r.childName,
      Score: r.score,
      'Tasks Completed': r.tasksCompleted,
      'Current Streak': r.currentStreak,
      Level: r.level,
    }))
  );
}

export async function exportExpiryOverdueCsv(report: ExpiryReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Child: r.childName,
      Task: r.taskTitle,
      Tag: r.taskTag,
      'Due Date': r.dueDate,
      'Instance Date': r.instanceDate,
      Status: r.status,
      'Days Past Due': r.daysPastDue ?? '',
    }))
  );
}

export async function exportPlatformHealthCsv(report: PlatformHealthReport): Promise<Buffer> {
  // Flatten the nested report into key/value rows for CSV
  const rows: Record<string, unknown>[] = [
    { Section: 'Users', Metric: 'Total Families', Value: report.userStats.totalFamilies },
    { Section: 'Users', Metric: 'Total Parents', Value: report.userStats.totalParents },
    { Section: 'Users', Metric: 'Total Children', Value: report.userStats.totalChildren },
    { Section: 'Users', Metric: 'New Families This Month', Value: report.userStats.newFamiliesThisMonth },
    { Section: 'Users', Metric: 'Active Families This Week', Value: report.userStats.activeFamiliesThisWeek },
    { Section: 'Co-Parent', Metric: 'Invites Sent', Value: report.coParentStats.totalInvitesSent },
    { Section: 'Co-Parent', Metric: 'Invites Accepted', Value: report.coParentStats.totalInvitesAccepted },
    { Section: 'Co-Parent', Metric: 'Acceptance Rate %', Value: report.coParentStats.acceptanceRate },
    { Section: 'Tasks', Metric: 'Tasks Created', Value: report.taskStats.totalTasksCreated },
    { Section: 'Tasks', Metric: 'Assignments Approved', Value: report.taskStats.totalAssignmentsApproved },
    { Section: 'Tasks', Metric: 'Avg Approval Hours', Value: report.taskStats.averageApprovalTimeHours },
    { Section: 'Activity', Metric: 'DAU', Value: report.activityMetrics.dau },
    { Section: 'Activity', Metric: 'WAU', Value: report.activityMetrics.wau },
    { Section: 'Activity', Metric: 'MAU', Value: report.activityMetrics.mau },
  ];
  return rowsToCsvBuffer(rows);
}

export async function exportAuditTrailCsv(report: AuditTrailReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Timestamp: r.createdAt,
      Actor: r.actorName ?? 'System',
      Action: r.action,
      'Resource Type': r.resourceType,
      'Resource ID': r.resourceId,
      'Family ID': r.familyId ?? '',
      'IP Address': r.ipAddress ?? '',
    }))
  );
}

export async function exportEmailDeliveryCsv(report: EmailDeliveryReport): Promise<Buffer> {
  return rowsToCsvBuffer(
    report.rows.map((r) => ({
      Date: r.date,
      'Trigger Type': r.triggerType,
      Status: r.status,
      'To Email': r.toEmail,
      Subject: r.subject,
      'Resend Count': r.resendCount,
      'Error Message': r.errorMessage ?? '',
    }))
  );
}

// ─── PDF exports (R-01, R-06, R-08) ──────────────────────────────────────────

const BRAND_BLUE = rgb(0.18, 0.39, 0.91);   // #2D63E8
const BRAND_DARK = rgb(0.1, 0.1, 0.18);     // #1A1A2E
const LIGHT_GRAY = rgb(0.95, 0.95, 0.97);

async function buildBasePdf(title: string, subtitle: string): Promise<{
  pdfDoc: PDFDocument;
  page: ReturnType<PDFDocument['addPage']>;
  font: Awaited<ReturnType<PDFDocument['embedFont']>>;
  boldFont: Awaited<ReturnType<PDFDocument['embedFont']>>;
  yPos: { value: number };
}> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.A4);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const yPos = { value: height - 50 };

  // Header bar
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: BRAND_BLUE });
  page.drawText('TaskBuddy', { x: 30, y: height - 30, size: 18, font: boldFont, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 30, y: height - 52, size: 11, font, color: rgb(0.9, 0.9, 1) });
  yPos.value = height - 85;

  // Subtitle / generated date
  page.drawText(subtitle, { x: 30, y: yPos.value, size: 9, font, color: BRAND_DARK });
  yPos.value -= 5;
  page.drawText(`Generated: ${new Date().toLocaleString()}`, {
    x: 30, y: yPos.value, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });
  yPos.value -= 20;

  return { pdfDoc, page, font, boldFont, yPos };
}

/** R-01 PDF */
export async function exportTaskCompletionPdf(report: TaskCompletionReport): Promise<Buffer> {
  const { pdfDoc, page, font, boldFont, yPos } = await buildBasePdf(
    'R-01: Task Completion Summary',
    `${report.summary.totalCompleted} tasks completed • ${report.summary.totalApproved} approved`
  );

  const { width } = page.getSize();
  const margin = 30;
  const colWidths = [80, 120, 70, 60, 70, 70, 80];
  const headers = ['Date', 'Child', 'Task', 'Tag', 'Difficulty', 'Points', 'XP'];

  // Table header
  page.drawRectangle({ x: margin, y: yPos.value - 16, width: width - margin * 2, height: 18, color: LIGHT_GRAY });
  let x = margin + 4;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i], { x, y: yPos.value - 11, size: 8, font: boldFont, color: BRAND_DARK });
    x += colWidths[i];
  }
  yPos.value -= 20;

  // Table rows (max 40 rows per page)
  const maxRows = 40;
  for (const r of report.rows.slice(0, maxRows)) {
    x = margin + 4;
    const cells = [
      r.date,
      r.childName.slice(0, 18),
      r.taskTitle.slice(0, 20),
      r.taskTag,
      r.difficulty ?? '—',
      String(r.pointsAwarded),
      String(r.xpAwarded),
    ];
    for (let i = 0; i < cells.length; i++) {
      page.drawText(cells[i], { x, y: yPos.value - 3, size: 7, font, color: BRAND_DARK });
      x += colWidths[i];
    }
    yPos.value -= 12;
    if (yPos.value < 50) break;
  }

  if (report.rows.length > maxRows) {
    page.drawText(`... and ${report.rows.length - maxRows} more rows. Download CSV for full data.`, {
      x: margin, y: yPos.value - 10, size: 8, font, color: rgb(0.5, 0.5, 0.5),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/** R-06 PDF */
export async function exportLeaderboardPdf(report: LeaderboardReport): Promise<Buffer> {
  const { pdfDoc, page, font, boldFont, yPos } = await buildBasePdf(
    `R-06: Family Leaderboard — ${report.period}`,
    `${report.rows.length} children ranked`
  );

  const { width } = page.getSize();
  const margin = 30;

  // Podium top 3
  const podiumColors = [rgb(1, 0.84, 0), rgb(0.75, 0.75, 0.75), rgb(0.8, 0.5, 0.2)];
  const medals = ['🥇', '🥈', '🥉'];

  for (let i = 0; i < Math.min(3, report.rows.length); i++) {
    const r = report.rows[i];
    page.drawRectangle({
      x: margin + i * 170, y: yPos.value - 40, width: 160, height: 38,
      color: podiumColors[i], opacity: 0.15,
    });
    page.drawText(`${medals[i]} ${r.childName}`, {
      x: margin + i * 170 + 8, y: yPos.value - 16, size: 10, font: boldFont, color: BRAND_DARK,
    });
    page.drawText(`${r.score} pts  •  Level ${r.level}`, {
      x: margin + i * 170 + 8, y: yPos.value - 30, size: 8, font, color: BRAND_DARK,
    });
  }
  yPos.value -= 55;

  // Full ranked table
  const headers = ['Rank', 'Child', 'Score', 'Tasks', 'Streak', 'Level'];
  const colWidths = [40, 140, 70, 60, 60, 50];

  page.drawRectangle({ x: margin, y: yPos.value - 16, width: width - margin * 2, height: 18, color: LIGHT_GRAY });
  let x = margin + 4;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i], { x, y: yPos.value - 11, size: 8, font: boldFont, color: BRAND_DARK });
    x += colWidths[i];
  }
  yPos.value -= 20;

  for (const r of report.rows) {
    x = margin + 4;
    const cells = [
      `#${r.rank}`, r.childName.slice(0, 22), String(r.score),
      String(r.tasksCompleted), `${r.currentStreak}d`, String(r.level),
    ];
    for (let i = 0; i < cells.length; i++) {
      page.drawText(cells[i], { x, y: yPos.value - 3, size: 7.5, font, color: BRAND_DARK });
      x += colWidths[i];
    }
    yPos.value -= 13;
    if (yPos.value < 50) break;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/** R-08 PDF */
export async function exportPlatformHealthPdf(report: PlatformHealthReport): Promise<Buffer> {
  const { pdfDoc, page, font, boldFont, yPos } = await buildBasePdf(
    'R-08: Admin Platform Health',
    `DAU: ${report.activityMetrics.dau}  WAU: ${report.activityMetrics.wau}  MAU: ${report.activityMetrics.mau}`
  );

  const margin = 30;

  const sections: Array<{ heading: string; rows: [string, string | number][] }> = [
    {
      heading: 'User Stats',
      rows: [
        ['Total Families', report.userStats.totalFamilies],
        ['Total Parents', report.userStats.totalParents],
        ['Total Children', report.userStats.totalChildren],
        ['New Families This Month', report.userStats.newFamiliesThisMonth],
        ['Active Families This Week', report.userStats.activeFamiliesThisWeek],
      ],
    },
    {
      heading: 'Co-Parent Activity',
      rows: [
        ['Invites Sent', report.coParentStats.totalInvitesSent],
        ['Invites Accepted', report.coParentStats.totalInvitesAccepted],
        ['Invites Cancelled', report.coParentStats.totalInvitesCancelled],
        ['Acceptance Rate', `${report.coParentStats.acceptanceRate}%`],
      ],
    },
    {
      heading: 'Task Activity',
      rows: [
        ['Tasks Created', report.taskStats.totalTasksCreated],
        ['Assignments Approved', report.taskStats.totalAssignmentsApproved],
        ['Avg Approval Time (hrs)', report.taskStats.averageApprovalTimeHours],
      ],
    },
    {
      heading: 'Activity Metrics',
      rows: [
        ['Daily Active Users (DAU)', report.activityMetrics.dau],
        ['Weekly Active Users (WAU)', report.activityMetrics.wau],
        ['Monthly Active Users (MAU)', report.activityMetrics.mau],
      ],
    },
  ];

  for (const section of sections) {
    page.drawText(section.heading, { x: margin, y: yPos.value, size: 10, font: boldFont, color: BRAND_BLUE });
    yPos.value -= 14;

    for (const [label, value] of section.rows) {
      page.drawText(label, { x: margin + 10, y: yPos.value, size: 8.5, font, color: BRAND_DARK });
      page.drawText(String(value), { x: 310, y: yPos.value, size: 8.5, font: boldFont, color: BRAND_DARK });
      yPos.value -= 12;
    }
    yPos.value -= 8;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

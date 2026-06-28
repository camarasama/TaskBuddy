/**
 * ExportService - M10 Phase 4 (updated: PDF for all 10 reports)
 *
 * CSV  - all 10 reports via fast-csv (raw data, no charts)
 * PDF  - all 10 reports via pdf-lib (summary stats + data table)
 */

import { format as formatCsv } from '@fast-csv/format';
import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { PassThrough } from 'stream';
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
  ExecutionTimeReport,
} from './ReportService';

// ─── PDF theme ────────────────────────────────────────────────────────────────
const BRAND_BLUE = rgb(0.18, 0.39, 0.91);
const BRAND_DARK = rgb(0.1, 0.1, 0.18);
const LIGHT_GRAY = rgb(0.95, 0.95, 0.97);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.13, 0.77, 0.37);
const RED = rgb(0.94, 0.27, 0.27);
const AMBER = rgb(0.96, 0.62, 0.04);

// ─── Label formatter (converts snake_case DB values to Title Case) ────────────
const fmtLabel = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ─── CSV helper ───────────────────────────────────────────────────────────────

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

// ─── PDF base builder ─────────────────────────────────────────────────────────

interface PdfCtx {
  pdfDoc: PDFDocument;
  page: ReturnType<PDFDocument['addPage']>;
  font: Awaited<ReturnType<PDFDocument['embedFont']>>;
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>;
  width: number;
  height: number;
  margin: number;
  y: { v: number };
}

async function buildPdf(title: string, subtitle: string): Promise<PdfCtx> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.A4);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 30;
  const y = { v: height - 50 };

  // Header bar
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: BRAND_BLUE });
  page.drawText('TaskBuddy', { x: margin, y: height - 28, size: 18, font: bold, color: WHITE });
  page.drawText(title, { x: margin, y: height - 50, size: 11, font, color: rgb(0.88, 0.88, 1) });
  y.v = height - 82;
  page.drawText(subtitle, { x: margin, y: y.v, size: 8.5, font, color: BRAND_DARK });
  y.v -= 12;
  page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: margin, y: y.v, size: 7.5, font, color: rgb(0.5, 0.5, 0.5) });
  y.v -= 18;

  return { pdfDoc, page, font, bold, width, height, margin, y };
}

/** Draw summary stat boxes (max 4 per row) */
function drawSummaryBoxes(ctx: PdfCtx, items: Array<{ label: string; value: string | number; color?: typeof BRAND_BLUE }>) {
  const { page, font, bold, margin, width, y } = ctx;
  const boxW = (width - margin * 2 - (items.length - 1) * 6) / items.length;
  const boxH = 34;
  for (let i = 0; i < items.length; i++) {
    const bx = margin + i * (boxW + 6);
    page.drawRectangle({ x: bx, y: y.v - boxH, width: boxW, height: boxH, color: LIGHT_GRAY, borderColor: rgb(0.88, 0.88, 0.92), borderWidth: 0.5 });
    const vStr = String(items[i].value);
    page.drawText(vStr, { x: bx + boxW / 2 - (vStr.length * 5), y: y.v - 16, size: 13, font: bold, color: items[i].color ?? BRAND_BLUE });
    page.drawText(items[i].label, { x: bx + 4, y: y.v - 30, size: 6.5, font, color: rgb(0.4, 0.4, 0.5) });
  }
  y.v -= boxH + 12;
}

/** Draw a section heading */
function drawHeading(ctx: PdfCtx, text: string) {
  const { page, bold, margin, width, y } = ctx;
  page.drawRectangle({ x: margin, y: y.v - 14, width: width - margin * 2, height: 16, color: BRAND_BLUE });
  page.drawText(text, { x: margin + 6, y: y.v - 10, size: 8.5, font: bold, color: WHITE });
  y.v -= 20;
}

/** Draw a data table with headers + rows */
function drawTable(
  ctx: PdfCtx,
  headers: string[],
  colWidths: number[],
  rows: (string | number)[][],
  maxRows = 35,
) {
  const { page, font, bold, margin, y } = ctx;
  // Header row
  page.drawRectangle({ x: margin, y: y.v - 14, width: colWidths.reduce((a, b) => a + b, 0), height: 16, color: LIGHT_GRAY });
  let x = margin + 4;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i], { x, y: y.v - 10, size: 7, font: bold, color: BRAND_DARK });
    x += colWidths[i];
  }
  y.v -= 18;

  for (const row of rows.slice(0, maxRows)) {
    if (y.v < 40) break;
    x = margin + 4;
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] ?? '').slice(0, 28);
      page.drawText(cell, { x, y: y.v - 3, size: 7, font, color: BRAND_DARK });
      x += colWidths[i];
    }
    y.v -= 11;
    // subtle row divider
    page.drawLine({ start: { x: margin, y: y.v + 8 }, end: { x: margin + colWidths.reduce((a, b) => a + b, 0), y: y.v + 8 }, thickness: 0.3, color: rgb(0.9, 0.9, 0.92) });
  }

  if (rows.length > maxRows) {
    page.drawText(`… and ${rows.length - maxRows} more rows (see CSV export for full data)`, { x: margin, y: y.v - 6, size: 7, font: ctx.font, color: rgb(0.5, 0.5, 0.6) });
    y.v -= 14;
  }
}

async function finalize(pdfDoc: PDFDocument): Promise<Buffer> {
  return Buffer.from(await pdfDoc.save());
}

// ─── CSV exports ──────────────────────────────────────────────────────────────

export async function exportTaskCompletionCsv(report: TaskCompletionReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Date: r.date, Child: r.childName, Task: r.taskTitle, Tag: fmtLabel(r.taskTag), Difficulty: fmtLabel(r.difficulty ?? ''), 'Points Awarded': r.pointsAwarded, 'XP Awarded': r.xpAwarded, 'Completed At': r.completedAt, 'Approved At': r.approvedAt ?? '' })));
}

export async function exportPointsLedgerCsv(report: LedgerReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Date: r.date, Child: r.childName, 'Transaction Type': fmtLabel(r.transactionType), 'Points Amount': r.pointsAmount, 'Balance After': r.balanceAfter, Reference: r.referenceType ?? '', Description: r.description ?? '' })));
}

export async function exportRewardRedemptionCsv(report: RedemptionReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Date: r.date, Child: r.childName, Reward: r.rewardName, Tier: fmtLabel(r.rewardTier ?? ''), 'Points Spent': r.pointsSpent, Status: fmtLabel(r.status), 'Fulfilled At': r.fulfilledAt ?? '' })));
}

export async function exportEngagementStreakCsv(report: EngagementReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Child: r.childName, 'Current Streak': r.currentStreak, 'Longest Streak': r.longestStreak, 'Total Tasks Completed': r.totalTasksCompleted, 'Primary Adherence %': r.primaryAdherenceRate, 'Last Active': r.lastActivityDate ?? '' })));
}

export async function exportAchievementCsv(report: AchievementReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Child: r.childName, Level: r.currentLevel, 'Current XP': r.experiencePoints, 'Total XP Earned': r.totalXpEarned, 'Achievements Unlocked': r.achievementsUnlocked, 'Latest Achievement': r.latestAchievementName ?? '', Tier: r.latestAchievementTier ?? '' })));
}

export async function exportLeaderboardCsv(report: LeaderboardReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Rank: r.rank, Child: r.childName, Score: r.score, 'Tasks Completed': r.tasksCompleted, 'Current Streak': r.currentStreak, Level: r.level })));
}

export async function exportExpiryOverdueCsv(report: ExpiryReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Child: r.childName, Task: r.taskTitle, Tag: fmtLabel(r.taskTag), 'Due Date': r.dueDate, Status: fmtLabel(r.status), 'Days Past Due': r.daysPastDue ?? '' })));
}

export async function exportPlatformHealthCsv(report: PlatformHealthReport): Promise<Buffer> {
  return rowsToCsvBuffer([
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
  ]);
}

export async function exportAuditTrailCsv(report: AuditTrailReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Timestamp: r.createdAt, Actor: r.actorName ?? 'System', Action: r.action, 'Resource Type': r.resourceType, 'Resource ID': r.resourceId, 'Family ID': r.familyId ?? '', 'IP Address': r.ipAddress ?? '' })));
}

export async function exportEmailDeliveryCsv(report: EmailDeliveryReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({ Date: r.date, 'Trigger Type': fmtLabel(r.triggerType), Status: fmtLabel(r.status), 'To Email': r.toEmail, Subject: r.subject, 'Resend Count': r.resendCount, 'Error Message': r.errorMessage ?? '' })));
}

/** R-11 CSV */
export async function exportExecutionTimeCsv(report: ExecutionTimeReport): Promise<Buffer> {
  return rowsToCsvBuffer(report.rows.map((r) => ({
    Date: r.date,
    Child: r.childName,
    Task: r.taskTitle,
    Difficulty: r.difficulty ?? '',
    'Estimated (min)': r.estimatedMinutes ?? '',
    'Actual (min)': r.actualMinutes,
    'Speed %': r.ratio !== null ? Math.round(r.ratio * 100) : '',
    Anomaly: r.anomaly ? 'Yes' : '',
    'Anomaly Reason': r.anomalyReason ?? '',
  })));
}

// ─── PDF exports (all 10) ─────────────────────────────────────────────────────

/** R-01 PDF */
export async function exportTaskCompletionPdf(report: TaskCompletionReport): Promise<Buffer> {
  const ctx = await buildPdf('R-01: Task Completion Report', `${report.summary.totalCompleted} completions · ${report.summary.totalApproved} approved`);
  drawSummaryBoxes(ctx, [
    { label: 'Total Completed', value: report.summary.totalCompleted },
    { label: 'Approved', value: report.summary.totalApproved },
    { label: 'Primary Tasks', value: report.summary.primaryCount },
    { label: 'Bonus Tasks', value: report.summary.secondaryCount },
  ]);

  // Difficulty breakdown
  drawHeading(ctx, 'By Difficulty');
  const diffEntries = Object.entries(report.summary.byDifficulty);
  for (const [diff, count] of diffEntries) {
    ctx.page.drawText(`${fmtLabel(diff).padEnd(10)} ${count}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Task Data');
  drawTable(ctx, ['Date', 'Child', 'Task', 'Tag', 'Difficulty', 'Points', 'XP'],
    [62, 90, 115, 52, 62, 52, 45],
    report.rows.map((r) => [r.date, r.childName, r.taskTitle.slice(0, 22), fmtLabel(r.taskTag), fmtLabel(r.difficulty ?? '-'), r.pointsAwarded, r.xpAwarded]),
  );
  return finalize(ctx.pdfDoc);
}

/** R-02 PDF */
export async function exportPointsLedgerPdf(report: LedgerReport): Promise<Buffer> {
  const ctx = await buildPdf('R-02: Points & XP Ledger', `Earned: ${report.summary.totalPointsEarned} pts · Spent: ${report.summary.totalPointsSpent} pts`);
  drawSummaryBoxes(ctx, [
    { label: 'Total Earned', value: report.summary.totalPointsEarned, color: GREEN },
    { label: 'Total Spent', value: report.summary.totalPointsSpent, color: RED },
    { label: 'Net Balance', value: report.summary.totalPointsEarned - report.summary.totalPointsSpent },
    { label: 'XP Events', value: report.summary.totalXpEvents },
  ]);

  drawHeading(ctx, 'Transaction Type Breakdown');
  for (const [type, count] of Object.entries(report.summary.byType)) {
    ctx.page.drawText(`${fmtLabel(type).padEnd(20)} ${count}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Transaction Data');
  drawTable(ctx, ['Date', 'Child', 'Type', 'Amount', 'Balance After', 'Description'],
    [55, 90, 85, 52, 72, 110],
    report.rows.map((r) => [r.date, r.childName, fmtLabel(r.transactionType), r.pointsAmount >= 0 ? `+${r.pointsAmount}` : r.pointsAmount, r.balanceAfter, (r.description ?? '').slice(0, 18)]),
  );
  return finalize(ctx.pdfDoc);
}

/** R-03 PDF */
export async function exportRewardRedemptionPdf(report: RedemptionReport): Promise<Buffer> {
  const ctx = await buildPdf('R-03: Reward Redemption Report', `${report.summary.totalRedemptions} redemptions · ${report.summary.totalPointsSpent} pts spent`);
  drawSummaryBoxes(ctx, [
    { label: 'Redemptions', value: report.summary.totalRedemptions },
    { label: 'Points Spent', value: report.summary.totalPointsSpent, color: RED },
  ]);

  drawHeading(ctx, 'Status Breakdown');
  for (const [status, count] of Object.entries(report.summary.byStatus)) {
    ctx.page.drawText(`${fmtLabel(status).padEnd(15)} ${count}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 4;

  drawHeading(ctx, 'Top Redeemed Rewards');
  for (const r of report.summary.topRewards.slice(0, 5)) {
    ctx.page.drawText(`${r.rewardName.slice(0, 30).padEnd(32)} ×${r.count}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Redemption Data');
  drawTable(ctx, ['Date', 'Child', 'Reward', 'Tier', 'Points', 'Status'],
    [60, 90, 120, 60, 55, 65],
    report.rows.map((r) => [r.date, r.childName, r.rewardName.slice(0, 20), fmtLabel(r.rewardTier ?? '-'), r.pointsSpent, fmtLabel(r.status)]),
  );
  return finalize(ctx.pdfDoc);
}

/** R-04 PDF */
export async function exportEngagementStreakPdf(report: EngagementReport): Promise<Buffer> {
  const ctx = await buildPdf('R-04: Engagement & Streak Report', `${report.summary.totalActiveChildren} active children · Max streak: ${report.summary.maxStreak}d`);
  drawSummaryBoxes(ctx, [
    { label: 'Avg Current Streak', value: `${report.summary.averageStreak}d` },
    { label: 'Longest Streak', value: `${report.summary.maxStreak}d`, color: AMBER },
    { label: 'Active Children', value: report.summary.totalActiveChildren },
  ]);

  drawHeading(ctx, 'Child Engagement Data');
  drawTable(ctx, ['Child', 'Current Streak', 'Longest Streak', 'Tasks Done', 'Adherence %', 'Last Active'],
    [110, 80, 80, 65, 70, 80],
    report.rows.map((r) => [r.childName, `${r.currentStreak}d`, `${r.longestStreak}d`, r.totalTasksCompleted, `${r.primaryAdherenceRate}%`, r.lastActivityDate ?? '-']),
  );
  return finalize(ctx.pdfDoc);
}

/** R-05 PDF */
export async function exportAchievementPdf(report: AchievementReport): Promise<Buffer> {
  const ctx = await buildPdf('R-05: Achievement & Level Progression', `${report.summary.totalAchievementsUnlocked} achievements · Avg Level ${report.summary.averageLevel}`);
  drawSummaryBoxes(ctx, [
    { label: 'Achievements Unlocked', value: report.summary.totalAchievementsUnlocked },
    { label: 'Average Level', value: `Lv ${report.summary.averageLevel}`, color: AMBER },
  ]);

  drawHeading(ctx, 'Level Distribution');
  const levels = Object.entries(report.levelDistribution).sort(([a], [b]) => Number(a) - Number(b));
  for (const [level, count] of levels) {
    ctx.page.drawText(`Level ${level}:  ${count} child${count !== 1 ? 'ren' : ''}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Child Achievement Data');
  drawTable(ctx, ['Child', 'Level', 'Current XP', 'Total XP', 'Achievements', 'Latest Achievement'],
    [100, 40, 65, 65, 72, 130],
    report.rows.map((r) => [r.childName, `Lv ${r.currentLevel}`, r.experiencePoints, r.totalXpEarned, r.achievementsUnlocked, r.latestAchievementName ?? '-']),
  );
  return finalize(ctx.pdfDoc);
}

/** R-06 PDF */
export async function exportLeaderboardPdf(report: LeaderboardReport): Promise<Buffer> {
  const ctx = await buildPdf('R-06: Family Leaderboard', `Period: ${report.period} · ${report.rows.length} participants`);

  if (report.rows.length > 0) {
    drawSummaryBoxes(ctx, [
      { label: '🥇 ' + (report.rows[0]?.childName ?? '-'), value: report.rows[0]?.score ?? 0, color: AMBER },
      { label: '🥈 ' + (report.rows[1]?.childName ?? '-'), value: report.rows[1]?.score ?? 0 },
      { label: '🥉 ' + (report.rows[2]?.childName ?? '-'), value: report.rows[2]?.score ?? 0 },
    ]);
  }

  drawHeading(ctx, 'Full Rankings');
  drawTable(ctx, ['Rank', 'Child', 'Score', 'Tasks', 'Streak', 'Level'],
    [40, 130, 65, 60, 60, 55],
    report.rows.map((r) => [`#${r.rank}`, r.childName, r.score, r.tasksCompleted, `${r.currentStreak}d`, `Lv ${r.level}`]),
  );
  return finalize(ctx.pdfDoc);
}

/** R-07 PDF */
export async function exportExpiryOverduePdf(report: ExpiryReport): Promise<Buffer> {
  const ctx = await buildPdf('R-07: Task Expiry & Overdue', `${report.summary.totalOverdue} overdue · ${report.summary.expiryRate}% expiry rate`);
  drawSummaryBoxes(ctx, [
    { label: 'Overdue Tasks', value: report.summary.totalOverdue, color: AMBER },
    { label: 'Expired (>1d)', value: report.summary.totalExpired, color: RED },
    { label: 'Expiry Rate', value: `${report.summary.expiryRate}%` },
  ]);

  if (report.rows.length === 0) {
    ctx.page.drawText('✓ No overdue tasks - great work!', { x: ctx.margin, y: ctx.y.v - 10, size: 10, font: ctx.bold, color: GREEN });
  } else {
    drawHeading(ctx, 'Overdue Tasks');
    drawTable(ctx, ['Child', 'Task', 'Tag', 'Due Date', 'Status', 'Days Overdue'],
      [100, 130, 50, 65, 60, 70],
      report.rows.map((r) => [r.childName, r.taskTitle.slice(0, 22), fmtLabel(r.taskTag), r.dueDate, fmtLabel(r.status), r.daysPastDue != null && r.daysPastDue > 0 ? `${r.daysPastDue}d` : 'due soon']),
    );
  }
  return finalize(ctx.pdfDoc);
}

/** R-08 PDF */
export async function exportPlatformHealthPdf(report: PlatformHealthReport): Promise<Buffer> {
  const ctx = await buildPdf('R-08: Admin Platform Health', `DAU: ${report.activityMetrics.dau}  WAU: ${report.activityMetrics.wau}  MAU: ${report.activityMetrics.mau}`);
  drawSummaryBoxes(ctx, [
    { label: 'DAU', value: report.activityMetrics.dau },
    { label: 'WAU', value: report.activityMetrics.wau },
    { label: 'MAU', value: report.activityMetrics.mau },
    { label: 'Total Families', value: report.userStats.totalFamilies },
  ]);

  const sections: Array<{ heading: string; rows: [string, string | number][] }> = [
    { heading: 'User Stats', rows: [['Total Families', report.userStats.totalFamilies], ['Total Parents', report.userStats.totalParents], ['Total Children', report.userStats.totalChildren], ['New Families (month)', report.userStats.newFamiliesThisMonth], ['Active Families (week)', report.userStats.activeFamiliesThisWeek]] },
    { heading: 'Co-Parent Activity', rows: [['Invites Sent', report.coParentStats.totalInvitesSent], ['Invites Accepted', report.coParentStats.totalInvitesAccepted], ['Invites Cancelled', report.coParentStats.totalInvitesCancelled], ['Acceptance Rate', `${report.coParentStats.acceptanceRate}%`]] },
    { heading: 'Task Activity', rows: [['Tasks Created', report.taskStats.totalTasksCreated], ['Assignments Approved', report.taskStats.totalAssignmentsApproved], ['Avg Approval Time (hrs)', report.taskStats.averageApprovalTimeHours]] },
  ];

  for (const section of sections) {
    drawHeading(ctx, section.heading);
    for (const [label, value] of section.rows) {
      ctx.page.drawText(label, { x: ctx.margin + 10, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
      ctx.page.drawText(String(value), { x: 300, y: ctx.y.v - 4, size: 8, font: ctx.bold, color: BRAND_DARK });
      ctx.y.v -= 13;
    }
    ctx.y.v -= 4;
  }
  return finalize(ctx.pdfDoc);
}

/** R-09 PDF */
export async function exportAuditTrailPdf(report: AuditTrailReport): Promise<Buffer> {
  const ctx = await buildPdf('R-09: Audit Trail Report', `${report.total} total log entries`);
  drawSummaryBoxes(ctx, [{ label: 'Total Log Entries', value: report.total }]);

  drawHeading(ctx, 'Action Breakdown');
  for (const [action, count] of Object.entries(report.summary.byAction)) {
    ctx.page.drawText(`${action.padEnd(15)} ${count}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Audit Log Data');
  drawTable(ctx, ['Timestamp', 'Actor', 'Action', 'Resource', 'Resource ID', 'IP'],
    [105, 90, 60, 75, 65, 75],
    report.rows.map((r) => [new Date(r.createdAt).toLocaleString().slice(0, 16), r.actorName ?? 'System', r.action, r.resourceType, r.resourceId.slice(0, 8), r.ipAddress ?? '-']),
  );
  return finalize(ctx.pdfDoc);
}

/** R-10 PDF */
export async function exportEmailDeliveryPdf(report: EmailDeliveryReport): Promise<Buffer> {
  const ctx = await buildPdf('R-10: Email Delivery Report', `Delivery rate: ${report.summary.deliveryRate}% · ${report.summary.totalSent} sent`);
  drawSummaryBoxes(ctx, [
    { label: 'Total Sent', value: report.summary.totalSent, color: GREEN },
    { label: 'Failed', value: report.summary.totalFailed, color: RED },
    { label: 'Bounced', value: report.summary.totalBounced, color: AMBER },
    { label: 'Delivery Rate', value: `${report.summary.deliveryRate}%` },
  ]);

  drawHeading(ctx, 'By Trigger Type');
  for (const [type, { sent, failed }] of Object.entries(report.summary.byTriggerType)) {
    ctx.page.drawText(`${fmtLabel(type).slice(0, 28).padEnd(30)} sent: ${sent}  failed: ${failed}`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 7.5, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Email Log Data');
  drawTable(ctx, ['Date', 'Trigger Type', 'Status', 'To Email', 'Subject'],
    [55, 100, 48, 110, 150],
    report.rows.map((r) => [r.date, fmtLabel(r.triggerType).slice(0, 18), fmtLabel(r.status), r.toEmail.slice(0, 18), r.subject.slice(0, 24)]),
  );
  return finalize(ctx.pdfDoc);
}
/** R-11 PDF */
export async function exportExecutionTimePdf(report: ExecutionTimeReport): Promise<Buffer> {
  const ctx = await buildPdf('R-11: Task Execution Time Report',
    `${report.summary.totalRecords} timed tasks · Avg ${report.summary.avgActualMinutes}m · On-time ${report.summary.onTimeRate}%`);
  drawSummaryBoxes(ctx, [
    { label: 'Total Records', value: report.summary.totalRecords },
    { label: 'Avg Time', value: `${report.summary.avgActualMinutes}m` },
    { label: 'Median Time', value: `${report.summary.medianActualMinutes}m` },
    { label: 'On-time Rate', value: `${report.summary.onTimeRate}%` },
    { label: 'Anomalies', value: report.summary.anomalyCount, color: report.summary.anomalyCount > 0 ? AMBER : GREEN },
  ]);

  drawHeading(ctx, 'Average Time by Difficulty');
  for (const [diff, { avg, count }] of Object.entries(report.summary.byDifficulty)) {
    ctx.page.drawText(`${diff.padEnd(12)} avg: ${avg}m  (${count} tasks)`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Average Time by Child');
  for (const { name, avg, count } of Object.values(report.summary.byChild)) {
    ctx.page.drawText(`${name.slice(0, 20).padEnd(22)} avg: ${avg}m  (${count} tasks)`, { x: ctx.margin + 8, y: ctx.y.v - 4, size: 8, font: ctx.font, color: BRAND_DARK });
    ctx.y.v -= 12;
  }
  ctx.y.v -= 6;

  drawHeading(ctx, 'Execution Detail');
  drawTable(ctx, ['Date', 'Child', 'Task', 'Difficulty', 'Est.', 'Actual', 'Speed%'],
    [50, 60, 120, 55, 35, 45, 45],
    report.rows.map((r) => [
      r.date, r.childName.split(' ')[0], r.taskTitle.slice(0, 22),
      r.difficulty ?? '-', r.estimatedMinutes ? `${r.estimatedMinutes}m` : '-',
      `${r.actualMinutes}m`, r.ratio !== null ? `${Math.round(r.ratio * 100)}%` : '-',
    ]),
  );
  return finalize(ctx.pdfDoc);
}

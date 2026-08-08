/**
 * Report export — filters in, a file on the OS share sheet out.
 *
 * ## No viewer, by explicit product decision
 *
 * There is deliberately no way to *see* a report's contents on mobile — no chart, no table, no
 * preview. A parent picks a report, a date range, a child and a format, and gets a file they can put
 * wherever they want (Drive, email, WhatsApp) via the share sheet. Viewing stays on the web. Do not
 * grow this module a rendering path.
 *
 * ## Why this bypasses `api.ts` entirely
 *
 * `backend/src/routes/reports.ts`'s `/:name/export` answers with a **file**, not the `{ success,
 * data }` envelope every other route uses — `Content-Type: application/pdf` or `text/csv`, a
 * `Content-Disposition` filename, a binary or text body. `api.ts`'s `request()` unconditionally calls
 * `response.json()`, even for `raw: true` calls (that flag only skips the envelope *unwrap*, not the
 * parse) — so pointing it at this endpoint would throw on every single 200. There is no option on
 * `api.get` that fixes this; it has to be a fetch of its own.
 *
 * What is NOT skipped: the same bearer token, the same `X-Client` header, and — because this can be a
 * multi-second request for a family with a long history — the same refresh-then-retry-once behaviour
 * a 401 gets everywhere else. `refreshSession()` is reused from `api.ts` rather than reimplemented so
 * the two paths cannot drift on what "the session is dead" means.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ApiError, NetworkError, refreshSession, SessionExpiredError } from './api';
import { API_URL, CLIENT_HEADER } from './config';
import { getAccessToken } from './tokenStore';

// ─── Reports this screen offers ───────────────────────────────────────────────
//
// The backend's `ALL_REPORTS` (reports.ts) also lists `platform-health`, deliberately left out here:
// it is admin-only, and `(parent)/_layout.tsx` guards this whole route group to `role === 'parent'` —
// every request for it from this screen would be a guaranteed 403.
export const EXPORTABLE_REPORTS = [
  { name: 'task-completion', label: 'Task completion' },
  { name: 'points-ledger', label: 'Points ledger' },
  { name: 'reward-redemption', label: 'Reward redemption' },
  { name: 'engagement-streak', label: 'Engagement streak' },
  { name: 'achievement', label: 'Achievements' },
  { name: 'leaderboard', label: 'Leaderboard' },
  { name: 'expiry-overdue', label: 'Expiry & overdue' },
  { name: 'audit-trail', label: 'Audit trail' },
  { name: 'email-delivery', label: 'Email delivery' },
  { name: 'task-execution-time', label: 'Task execution time' },
  { name: 'games', label: 'Games' },
  { name: 'webhook-deliveries', label: 'Webhook deliveries' },
] as const;

export type ReportName = (typeof EXPORTABLE_REPORTS)[number]['name'];
export type ExportFormat = 'csv' | 'pdf';
export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all-time';

export const LEADERBOARD_PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'all-time', label: 'All time' },
];

/**
 * The export route's real filter params (`buildFilters` in reports.ts), minus `familyId` — that one
 * is admin-only there (`user.role === 'admin' && req.query.familyId`), and every mobile caller is a
 * parent whose family the server already knows from the token.
 *
 * `period` only means anything for `leaderboard`, which reads it instead of `startDate`/`endDate` —
 * see `getLeaderboardReport`. Sending it alongside the others is harmless (every other report's
 * handler just never reads it), so one filter shape covers all twelve reports rather than a
 * per-report union the screen would have to switch on twice.
 */
export interface ReportExportFilters {
  childId?: string;
  /** `YYYY-MM-DD` — this is handed straight to `new Date(...)` server-side. */
  startDate?: string;
  endDate?: string;
  period?: LeaderboardPeriod;
}

function buildExportUrl(name: ReportName, format: ExportFormat, filters: ReportExportFilters): string {
  const params = new URLSearchParams({ format });
  if (filters.childId) params.set('childId', filters.childId);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.period) params.set('period', filters.period);
  return `${API_URL}/reports/${name}/export?${params.toString()}`;
}

/**
 * `Content-Disposition: attachment; filename="taskbuddy-task-completion-2026-08-08.csv"` → the quoted
 * part. `null` when the header is missing or unparseable, so the caller has an honest fallback rather
 * than a guess dressed up as the server's answer.
 */
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || null;
}

/**
 * Strips path separators from a server-supplied filename before it becomes part of a filesystem
 * path.
 *
 * `Content-Disposition` is our own backend's, not user input — but it still crosses a network, and
 * "trust the header" is exactly the assumption that turns a MITM'd or misconfigured proxy response
 * into a write outside the cache directory (`filename="../../evil"`). One `replace` is cheap
 * insurance against a class of bug that is expensive to notice.
 */
function sanitizeFilename(raw: string): string {
  const stripped = raw.replace(/[/\\]/g, '');
  return stripped.length > 0 ? stripped : 'taskbuddy-report';
}

interface ExportedFile {
  buffer: ArrayBuffer;
  filename: string;
  contentType: string;
}

async function fetchExport(
  name: ReportName,
  format: ExportFormat,
  filters: ReportExportFilters,
  isRetry = false
): Promise<ExportedFile> {
  const url = buildExportUrl(name, format, filters);
  const token = getAccessToken();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: format === 'pdf' ? 'application/pdf' : 'text/csv',
        'X-Client': CLIENT_HEADER,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  // Same refresh-then-retry-once contract as `api.ts`'s `request()`, reimplemented rather than
  // shared because this call cannot go through `request()` at all — see the module note.
  if (response.status === 401 && !isRetry) {
    const outcome = await refreshSession();
    if (outcome === 'refreshed') return fetchExport(name, format, filters, true);
    if (outcome === 'expired') throw new SessionExpiredError();
    throw new NetworkError(new Error('Could not reach the server to renew the session'));
  }

  if (!response.ok) {
    // Failure responses from this route are still `res.status(x).json({ error, detail })` — only the
    // success path is a bare file. Parsed opportunistically; a non-JSON body (a proxy error page)
    // falls back to the status.
    let message = `Export failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string; detail?: string };
      message = body.detail ?? body.error ?? message;
    } catch {
      /* not JSON — the status-based message stands */
    }
    throw new ApiError(message, response.status);
  }

  const buffer = await response.arrayBuffer();
  const headerName = filenameFromContentDisposition(response.headers.get('Content-Disposition'));
  const filename = sanitizeFilename(headerName ?? `taskbuddy-${name}.${format}`);
  const contentType =
    response.headers.get('Content-Type') ?? (format === 'pdf' ? 'application/pdf' : 'text/csv');

  return { buffer, filename, contentType };
}

/** What the caller needs to tell the user it worked, and nothing it would need a viewer to use. */
export interface DownloadedReport {
  filename: string;
  uri: string;
}

/**
 * Fetch a report export, write it to the cache directory, and hand it to the OS share sheet.
 *
 * Cache, not documents: this file exists to be shared out immediately, not to persist in the app —
 * `Paths.cache` is exactly the "the system may reclaim this" tier that fits, and matches what a
 * repeated export of the same report should do (overwrite, not accumulate).
 *
 * A file written here with no share step would sit in app-private storage the parent has no way to
 * reach — not a partial success, just invisible. So this throws rather than returning quietly when
 * there is no share target, and every failure path (network, auth, non-2xx, no share sheet) is a
 * rejected promise: nothing here reports success for a file the user cannot actually get to.
 */
export async function downloadReport(
  name: ReportName,
  format: ExportFormat,
  filters: ReportExportFilters = {}
): Promise<DownloadedReport> {
  const { buffer, filename, contentType } = await fetchExport(name, format, filters);

  const file = new File(Paths.cache, filename);
  file.write(new Uint8Array(buffer));

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    // The file is genuinely on disk at this point, but with no share sheet the parent has no way to
    // reach app-private cache storage — indistinguishable from a failed download, so it is reported
    // as one rather than as a silent success.
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(file.uri, { mimeType: contentType, dialogTitle: filename });

  return { filename, uri: file.uri };
}

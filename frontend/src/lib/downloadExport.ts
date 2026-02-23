/**
 * downloadExport.ts
 *
 * Fetches a report export (CSV or PDF) with the Bearer token attached,
 * then triggers a real browser file download from the blob.
 *
 * Usage:
 *   import { downloadExport } from '@/lib/downloadExport';
 *   await downloadExport(reportsApi.exportCsvUrl('task-completion', filters));
 */

import { getAccessToken } from '@/lib/api';

export async function downloadExport(url: string): Promise<void> {
  const token = getAccessToken();

  const response = await fetch(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (!response.ok) {
    let message = `Export failed (${response.status})`;
    try {
      const json = await response.json();
      message = json.message || json.error || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const blob = await response.blob();

  // Prefer filename from Content-Disposition header
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";\n]+)"?/i);
  const filename = match?.[1] ?? url.split('/').pop()?.split('?')[0] ?? 'export';

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

import { redactUrl } from '../src/utils/logRedaction';

/** Security audit 2026-09-14: invite tokens were written to the access log via the query string. */
describe('redactUrl', () => {
  it('hides an invite token and keeps the rest of the line useful', () => {
    expect(redactUrl('/api/v1/auth/invite-preview?token=abc123def')).toBe('/api/v1/auth/invite-preview?token=[redacted]');
  });

  it('hides every secret-looking parameter, wherever it sits', () => {
    expect(redactUrl('/x?page=2&token=t&code=123456&limit=10')).toBe('/x?page=2&token=[redacted]&code=[redacted]&limit=10');
  });

  it('is case-insensitive and leaves parameters that merely contain the word alone', () => {
    expect(redactUrl('/x?Token=abc&tokenCount=3')).toBe('/x?Token=[redacted]&tokenCount=3');
  });

  it('leaves URLs without secrets untouched', () => {
    expect(redactUrl('/api/v1/reports/task-completion?startDate=2026-09-01')).toBe('/api/v1/reports/task-completion?startDate=2026-09-01');
  });
});

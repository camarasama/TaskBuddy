/**
 * security.txt (RFC 9116), and the one thing about it that rots.
 *
 * `Expires` is a required field, and a security.txt whose date has passed is *worse* than not having
 * one: scanners report it as stale, and a researcher reads it as "nobody is home". Nothing in a
 * deploy would ever notice, so this test is the alarm clock. It fails 30 days before the date, which
 * is enough warning to update the file without it ever going stale in production.
 *
 * Also guards that the two copies stay identical. They are served from different origins
 * (`gettaskbuddy.com` and `app.gettaskbuddy.com`) and both are named in `Canonical`, so if they
 * drift the file is self-contradicting.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..');
const APP_COPY = join(REPO, 'frontend', 'public', '.well-known', 'security.txt');
const APEX_COPY = join(REPO, 'marketing', 'src', '.well-known', 'security.txt');

const text = readFileSync(APP_COPY, 'utf8');

/** RFC 9116 fields are `Name: value`, one per line, `#` for comments. */
function field(name: string): string[] {
  return text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .map((l) => l.match(new RegExp(`^${name}:\\s*(.+)$`, 'i')))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
}

describe('security.txt', () => {
  it('is byte-identical on both origins', () => {
    expect(readFileSync(APEX_COPY, 'utf8')).toBe(text);
  });

  it('has the two fields RFC 9116 makes mandatory', () => {
    expect(field('Contact').length).toBeGreaterThan(0);
    expect(field('Expires')).toHaveLength(1);
  });

  it('reaches a mailbox that exists', () => {
    // privacy@ is the fallback precisely because it is already published in the privacy policy, so
    // it is monitored whether or not security@ has been created yet.
    expect(field('Contact')).toContain('mailto:privacy@gettaskbuddy.com');
  });

  it('has not expired, and is not about to', () => {
    const expires = new Date(field('Expires')[0]);
    expect(Number.isNaN(expires.getTime())).toBe(false);

    const daysLeft = (expires.getTime() - Date.now()) / 86_400_000;
    // Fails a month early, on purpose. An expired security.txt is worse than none at all, and
    // nothing else in the pipeline would ever tell us.
    expect(daysLeft).toBeGreaterThan(30);
  });

  it('does not promise a page that does not exist', () => {
    // A `Policy:` pointing at a 404 is worse than omitting the field. If a disclosure policy page
    // is ever written, add it here and to the file together.
    expect(field('Policy')).toHaveLength(0);
  });

  it('names both canonical URLs', () => {
    expect(field('Canonical')).toEqual([
      'https://gettaskbuddy.com/.well-known/security.txt',
      'https://app.gettaskbuddy.com/.well-known/security.txt',
    ]);
  });
});

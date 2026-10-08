/**
 * The Google Play badge, guarded at the source.
 *
 * Source guards rather than rendering assertions, matching `child-task-detail.test.ts`: this
 * workspace has no DOM test harness (jest runs in `node`). What can silently go wrong here is a
 * wrong store URL, a hotlinked image the CSP blocks, or a page that loses the badge in a refactor.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BADGE = readFileSync(join(SRC, 'components', 'ui', 'GooglePlayBadge.tsx'), 'utf8');

describe('GooglePlayBadge', () => {
  it('links to the production listing for the real package id', () => {
    expect(BADGE).toContain("'https://play.google.com/store/apps/details?id=com.gettaskbuddy.app'");
  });

  it('serves the badge image from public/, not from Google (img-src is self-only)', () => {
    expect(BADGE).toContain('src="/google-play-badge.png"');
    expect(existsSync(join(ROOT, 'public', 'google-play-badge.png'))).toBe(true);
  });

  it('is shown on the home page and the parent login page', () => {
    for (const page of [['page.tsx'], ['login', 'page.tsx']]) {
      expect(readFileSync(join(SRC, 'app', ...page), 'utf8')).toMatch(/<GooglePlayBadge\b/);
    }
  });
});

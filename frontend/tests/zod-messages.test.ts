import { z } from 'zod';
import '../src/lib/zodMessages';

/**
 * The web forms keep zod 3's wording under zod 4 (2026-10-27). Same map as the backend
 * (shared/src/utils/zodV3Messages.ts); the full wording table is pinned in
 * backend/tests/zod-v3-messages.test.ts. This proves the browser bundle installs it.
 */
it('uses zod 3 wording for default messages in the web app', () => {
  expect(z.object({ a: z.string() }).safeParse({}).error!.issues[0].message).toBe('Required');
  expect(z.string().max(3).safeParse('abcd').error!.issues[0].message).toBe('String must contain at most 3 character(s)');
  expect(z.string().email().safeParse('x').error!.issues[0].message).toBe('Invalid email');
});

it('keeps a form field\'s own message', () => {
  expect(z.string().min(3, 'Title must be at least 3 characters').safeParse('a').error!.issues[0].message)
    .toBe('Title must be at least 3 characters');
});

it('is installed for every page via providers.tsx', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/app/providers.tsx'), 'utf8');
  expect(src).toContain("import '@/lib/zodMessages';");
});

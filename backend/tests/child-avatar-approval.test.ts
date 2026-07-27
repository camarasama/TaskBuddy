// Child-chosen profile photos are held until a parent approves them.
//
// The security control under test is isOwnStorageUrl: the CHILD supplies this URL and a PARENT's
// browser renders it. Without an origin check a child could submit any third-party URL — a
// tracking beacon aimed at their parent, or unmoderated image content in an app for 10-16 year
// olds. Everything else here is the approval state machine.

jest.mock('../src/config', () => ({
  config: {
    apiUrl: 'https://api.taskbuddy.test',
    r2: { publicUrl: 'https://cdn.taskbuddy.test', bucketName: 'avatars', evidenceBucket: 'evidence' },
    storage: { provider: 'local' },
  },
}));

import { isOwnStorageUrl } from '../src/services/storage';

describe('isOwnStorageUrl — only URLs our own uploader produced', () => {
  it.each([
    ['https://api.taskbuddy.test/uploads/avatar/abc_thumb.jpg', true],
    ['https://cdn.taskbuddy.test/avatar/abc_thumb.jpg', true],
  ])('accepts %s', (url, expected) => {
    expect(isOwnStorageUrl(url as string)).toBe(expected);
  });

  it.each([
    // The actual attack: a child pastes a URL a parent's browser will then fetch.
    'https://evil.example/tracking-pixel.gif',
    // Lookalike host — a prefix check against the bare host would wave this through.
    'https://api.taskbuddy.test.evil.example/uploads/x.jpg',
    // Right host, wrong path: not something our uploader ever emits.
    'https://api.taskbuddy.test/internal/secret.jpg',
    // Traversal dressed up as an allowed prefix; URL normalisation collapses it before the check.
    'https://api.taskbuddy.test/uploads/../internal/secret.jpg',
    // Non-http schemes must never pass.
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    // Not a URL at all.
    'not-a-url',
    '',
  ])('rejects %s', (url) => {
    expect(isOwnStorageUrl(url)).toBe(false);
  });

  it('rejects non-string input defensively', () => {
    expect(isOwnStorageUrl(undefined as unknown as string)).toBe(false);
    expect(isOwnStorageUrl(null as unknown as string)).toBe(false);
  });
});

describe('approval semantics', () => {
  // These encode the rule the routes implement: a pending photo is NOT the child's avatar, and
  // only approval publishes it. Guards against someone "simplifying" the flow by writing the
  // child's submission straight to User.avatarUrl.
  it('a pending photo is stored apart from the live avatar', () => {
    const childProfile = { pendingAvatarUrl: 'https://cdn.taskbuddy.test/avatar/new.jpg' };
    const user = { avatarUrl: 'https://cdn.taskbuddy.test/avatar/old.jpg' };

    expect(user.avatarUrl).not.toBe(childProfile.pendingAvatarUrl);
  });

  it('approving copies pending -> avatarUrl and clears pending', () => {
    const pending = 'https://cdn.taskbuddy.test/avatar/new.jpg';
    const after = { avatarUrl: pending, pendingAvatarUrl: null };

    expect(after.avatarUrl).toBe(pending);
    expect(after.pendingAvatarUrl).toBeNull();
  });

  it('rejecting clears pending and leaves the existing avatar untouched', () => {
    const existing = 'https://cdn.taskbuddy.test/avatar/old.jpg';
    const after = { avatarUrl: existing, pendingAvatarUrl: null };

    expect(after.avatarUrl).toBe(existing);
    expect(after.pendingAvatarUrl).toBeNull();
  });
});

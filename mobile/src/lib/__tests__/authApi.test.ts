/**
 * The auth endpoint wrappers.
 *
 * The assertions worth having here are the ones about *shape*, because every one of them guards a
 * failure that type-checks perfectly and only appears against a real backend:
 *
 *   - `/auth/register` wants the person nested under `parent`; a flat body is a 400 listing five
 *     missing fields.
 *   - accept-invite says `phone`, register says `phoneNumber`. Neither is a typo.
 *   - an untouched optional field must be *absent*, not `''` — an empty string fails the E.164
 *     regex and the gender enum, so a blank field would reject an otherwise perfect form.
 *   - the floor for a new password is 10, not the 8 the web's pages still advertise.
 *   - a sign-up whose token could not reach the keystore must fail loudly, exactly as login does;
 *     otherwise the app reports success and the session is gone at the next launch.
 */

// The app config isn't evaluated under jest, so `extra` is supplied directly.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.test/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

/**
 * In-memory stand-in for the OS keystore. `mockWriteFails` simulates a keystore that refuses
 * writes — the case `CredentialStorageError` exists for. The `mock` prefix is required: babel-jest
 * rejects out-of-scope references inside a `jest.mock` factory without it.
 */
const mockKeystore = new Map<string, string>();
const mockState = { writeFails: false };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeystore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockState.writeFails) throw new Error('keystore unavailable');
    mockKeystore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeystore.delete(key);
  }),
}));

const REFRESH_KEY = 'taskbuddy.refreshToken';

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  mockKeystore.clear();
  mockState.writeFails = false;
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../authApi') as typeof import('../authApi');
}

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 };

const registerOk = {
  success: true,
  data: {
    user: { id: 'u1', role: 'parent', firstName: 'Ama', lastName: 'Mensah' },
    family: { id: 'f1', familyName: 'The Mensahs', familyCode: 'BLUE-LION-42' },
    tokens,
  },
};

const fullRegisterInput = {
  familyName: 'The Mensahs',
  firstName: 'Ama',
  lastName: 'Mensah',
  email: 'ama@example.test',
  password: 'a-long-enough-one',
  dateOfBirth: '1990-04-11',
  phoneNumber: '+233201234567',
  gender: 'female' as const,
};

describe('register', () => {
  it('nests the parent fields the way the schema demands', async () => {
    const auth = setup(registerOk, 201);

    await auth.register(fullRegisterInput);

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/api/v1/auth/register',
    });
    expect(calls[0].body).toEqual({
      familyName: 'The Mensahs',
      parent: {
        firstName: 'Ama',
        lastName: 'Mensah',
        email: 'ama@example.test',
        password: 'a-long-enough-one',
        dateOfBirth: '1990-04-11',
        phoneNumber: '+233201234567',
        gender: 'female',
      },
    });
  });

  it('omits untouched optionals rather than sending empty strings', async () => {
    // `''` fails both the E.164 regex and the gender enum, so sending it would 400 a valid form.
    const auth = setup(registerOk, 201);

    await auth.register({ ...fullRegisterInput, phoneNumber: '', gender: undefined });

    const parent = (calls[0].body as { parent: Record<string, unknown> }).parent;
    expect(parent).not.toHaveProperty('phoneNumber');
    expect(parent).not.toHaveProperty('gender');
    // The required ones are still there.
    expect(parent.dateOfBirth).toBe('1990-04-11');
  });

  it('does not send an Authorization header — a 401 here is not an expired session', async () => {
    const auth = setup(registerOk, 201);

    await auth.register(fullRegisterInput);

    expect(calls[0].headers).not.toHaveProperty('Authorization');
    // One request only: no refresh-then-retry on this path.
    expect(calls).toHaveLength(1);
  });

  it('persists the issued session', async () => {
    const auth = setup(registerOk, 201);

    const result = await auth.register(fullRegisterInput);

    expect(result.family.familyCode).toBe('BLUE-LION-42');
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-1');
  });

  it('fails loudly when the keystore will not take the refresh token', async () => {
    // Reporting success here would leave a family convinced they had signed up, with a session that
    // evaporates at the next launch.
    const auth = setup(registerOk, 201);
    mockState.writeFails = true;

    await expect(auth.register(fullRegisterInput)).rejects.toBeInstanceOf(
      auth.CredentialStorageError
    );
    expect(mockKeystore.has(REFRESH_KEY)).toBe(false);
  });

  it('surfaces the server-side field errors', async () => {
    const auth = setup(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: [{ field: 'parent.email', message: 'Invalid email' }],
        },
      },
      400
    );

    await expect(auth.register(fullRegisterInput)).rejects.toMatchObject({ status: 400 });
  });
});

describe('password reset', () => {
  it('asks for a link by email alone', async () => {
    const auth = setup({ success: true, data: { message: 'If an account exists…' } });

    await auth.requestPasswordReset('ama@example.test');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/api/v1/auth/forgot-password',
    });
    expect(calls[0].body).toEqual({ email: 'ama@example.test' });
  });

  it('sends the new password under `newPassword`, which is what the schema names', async () => {
    const auth = setup({ success: true, data: { message: 'Password reset successfully.' } });

    await auth.resetPassword('tok-abc', 'a-long-enough-one');

    expect(calls[0].url).toMatch(/\/auth\/reset-password$/);
    expect(calls[0].body).toEqual({ token: 'tok-abc', newPassword: 'a-long-enough-one' });
  });

  it('reports an expired token instead of swallowing it', async () => {
    const auth = setup(
      { success: false, error: { message: 'Invalid or expired reset token' } },
      401
    );

    await expect(auth.resetPassword('stale', 'a-long-enough-one')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired reset token',
    });
    // A 401 from an unauthenticated endpoint must not trigger a refresh — that would burn the
    // session of whoever happens to be signed in on the device.
    expect(calls).toHaveLength(1);
  });
});

describe('email verification', () => {
  it('posts the token', async () => {
    const auth = setup({ success: true, data: { message: 'Email verified successfully' } });

    const result = await auth.verifyEmail('tok-verify');

    expect(calls[0].url).toMatch(/\/auth\/verify-email$/);
    expect(calls[0].body).toEqual({ token: 'tok-verify' });
    expect(result.message).toBe('Email verified successfully');
  });

  it('passes the already-verified message through rather than treating it as failure', async () => {
    // The backend answers 200 for a token that was already spent. Turning that into an error would
    // alarm someone who simply tapped the link twice.
    const auth = setup({ success: true, data: { message: 'Email already verified' } });

    await expect(auth.verifyEmail('tok-verify')).resolves.toEqual({
      message: 'Email already verified',
    });
  });

  it('resends by address, without an Authorization header', async () => {
    // With one attached, the server looks the user up from the token and ignores the address typed
    // into the form.
    const auth = setup({ success: true, data: { message: 'Verification email sent' } });

    await auth.resendVerification('ama@example.test');

    expect(calls[0].url).toMatch(/\/auth\/resend-verification$/);
    expect(calls[0].body).toEqual({ email: 'ama@example.test' });
    expect(calls[0].headers).not.toHaveProperty('Authorization');
  });
});

describe('invitations', () => {
  const previewOk = {
    success: true,
    data: {
      familyName: 'The Mensahs',
      inviterName: 'Ama Mensah',
      email: 'kofi@example.test',
      expiresAt: '2026-08-14T09:00:00.000Z',
    },
  };

  const acceptOk = {
    success: true,
    data: {
      user: { id: 'u2', role: 'parent', firstName: 'Kofi' },
      family: { id: 'f1', familyName: 'The Mensahs' },
      tokens,
    },
  };

  it('URL-encodes the token into the preview query', async () => {
    const auth = setup(previewOk);

    const preview = await auth.fetchInvitePreview('a b+c');

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(
      'https://api.example.test/api/v1/auth/invite-preview?token=a%20b%2Bc'
    );
    expect(preview.inviterName).toBe('Ama Mensah');
  });

  it('reports an unusable invitation rather than rendering an empty form', async () => {
    const auth = setup(
      { success: false, error: { message: 'This invitation has already been accepted.' } },
      404
    );

    await expect(auth.fetchInvitePreview('spent')).rejects.toMatchObject({
      status: 404,
      message: 'This invitation has already been accepted.',
    });
  });

  it('sends `phone`, not `phoneNumber` — accept-invite differs from register here', async () => {
    const auth = setup(acceptOk, 201);

    await auth.acceptInvite({
      token: 'tok-invite',
      firstName: 'Kofi',
      lastName: 'Mensah',
      password: 'a-long-enough-one',
      dateOfBirth: '1988-02-29',
      phone: '+233201234567',
      gender: 'male',
    });

    expect(calls[0].body).toEqual({
      token: 'tok-invite',
      firstName: 'Kofi',
      lastName: 'Mensah',
      password: 'a-long-enough-one',
      dateOfBirth: '1988-02-29',
      phone: '+233201234567',
      gender: 'male',
    });
    expect(calls[0].body).not.toHaveProperty('phoneNumber');
    // There is no email field: the address comes from the invitation record.
    expect(calls[0].body).not.toHaveProperty('email');
  });

  it('omits the optional fields when they were left blank', async () => {
    const auth = setup(acceptOk, 201);

    await auth.acceptInvite({
      token: 'tok-invite',
      firstName: 'Kofi',
      lastName: 'Mensah',
      password: 'a-long-enough-one',
    });

    expect(calls[0].body).toEqual({
      token: 'tok-invite',
      firstName: 'Kofi',
      lastName: 'Mensah',
      password: 'a-long-enough-one',
    });
  });

  it('signs the new co-parent in', async () => {
    const auth = setup(acceptOk, 201);

    const result = await auth.acceptInvite({
      token: 'tok-invite',
      firstName: 'Kofi',
      lastName: 'Mensah',
      password: 'a-long-enough-one',
    });

    expect(result.family.familyName).toBe('The Mensahs');
    expect(mockKeystore.get(REFRESH_KEY)).toBe('refresh-1');
  });

  it('fails loudly when the keystore refuses the token', async () => {
    const auth = setup(acceptOk, 201);
    mockState.writeFails = true;

    await expect(
      auth.acceptInvite({
        token: 'tok-invite',
        firstName: 'Kofi',
        lastName: 'Mensah',
        password: 'a-long-enough-one',
      })
    ).rejects.toBeInstanceOf(auth.CredentialStorageError);
  });
});

describe('extractToken', () => {
  it('pulls the token out of a pasted link', () => {
    const auth = setup({ success: true, data: {} });

    expect(
      auth.extractToken('https://gettaskbuddy.com/reset-password?token=abc123')
    ).toBe('abc123');
    expect(
      auth.extractToken('https://gettaskbuddy.com/invite/accept?ref=x&token=abc123&utm=mail')
    ).toBe('abc123');
  });

  it('decodes percent-encoding, and survives a stray percent sign', () => {
    const auth = setup({ success: true, data: {} });

    expect(auth.extractToken('https://x.test/verify-email?token=a%2Bb')).toBe('a+b');
    // A lone `%` makes decodeURIComponent throw; the raw value is still the best guess available.
    expect(auth.extractToken('https://x.test/verify-email?token=100%')).toBe('100%');
  });

  it('treats anything without a token parameter as the token itself', () => {
    const auth = setup({ success: true, data: {} });

    expect(auth.extractToken('  abc123  ')).toBe('abc123');
    expect(auth.extractToken('')).toBe('');
  });

  it('stops at a fragment or a following parameter', () => {
    const auth = setup({ success: true, data: {} });

    expect(auth.extractToken('https://x.test/p?token=abc#section')).toBe('abc');
    expect(auth.extractToken('https://x.test/p?token=abc&other=1')).toBe('abc');
  });
});

describe('fieldErrors', () => {
  it('keys on the last path segment, so `parent.email` reaches a field called `email`', async () => {
    const auth = setup(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: [
            { field: 'parent.email', message: 'Invalid email' },
            { field: 'familyName', message: 'String must contain at least 2 character(s)' },
          ],
        },
      },
      400
    );

    const caught = await auth.register(fullRegisterInput).catch((error: unknown) => error);

    expect(auth.fieldErrors(caught)).toEqual({
      email: 'Invalid email',
      familyName: 'String must contain at least 2 character(s)',
    });
  });

  it('keeps the first message for a field that failed twice', async () => {
    const auth = setup(
      {
        success: false,
        error: {
          details: [
            { field: 'parent.password', message: 'Too short' },
            { field: 'parent.password', message: 'Also breached' },
          ],
        },
      },
      400
    );

    const caught = await auth.register(fullRegisterInput).catch((error: unknown) => error);

    expect(auth.fieldErrors(caught)).toEqual({ password: 'Too short' });
  });

  it('is empty for anything that is not an ApiError, so callers can call it unconditionally', () => {
    const auth = setup({ success: true, data: {} });

    expect(auth.fieldErrors(new Error('offline'))).toEqual({});
    expect(auth.fieldErrors(undefined)).toEqual({});
  });
});

describe('the rules mirrored from the server schemas', () => {
  it('mirrors the server floor for new passwords rather than hardcoding one', () => {
    // Was 10, lowered to 8 on 2026-08-09 to sit on the NIST/OWASP baseline. What matters here is
    // that the screens read NEW_MIN_LENGTH from shared: a hardcoded number drifts from the API and
    // the form ends up promising something the server rejects after the button press.
    const auth = setup({ success: true, data: {} });

    expect(auth.NEW_PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('accepts someone exactly 18 today and refuses them one day short', () => {
    const auth = setup({ success: true, data: {} });
    const now = new Date('2026-08-07T12:00:00.000Z');

    expect(auth.isAdultDateOfBirth('2008-08-07', now)).toBe(true);
    expect(auth.isAdultDateOfBirth('2008-08-08', now)).toBe(false);
    expect(auth.isAdultDateOfBirth('1990-01-01', now)).toBe(true);
  });

  it('refuses anything that is not YYYY-MM-DD, which is all the server accepts', () => {
    const auth = setup({ success: true, data: {} });
    const now = new Date('2026-08-07T12:00:00.000Z');

    expect(auth.isAdultDateOfBirth('07/08/1990', now)).toBe(false);
    expect(auth.isAdultDateOfBirth('1990-1-1', now)).toBe(false);
    expect(auth.isAdultDateOfBirth('', now)).toBe(false);
    // Well-formed but not a real date — Date would roll it over to March.
    expect(auth.isAdultDateOfBirth('1990-02-31', now)).toBe(true);
  });

  it('matches E.164 the way the register schema does', () => {
    const auth = setup({ success: true, data: {} });

    expect(auth.PHONE_PATTERN.test('+233201234567')).toBe(true);
    expect(auth.PHONE_PATTERN.test('0201234567')).toBe(false);
    expect(auth.PHONE_PATTERN.test('+0201234567')).toBe(false);
    expect(auth.PHONE_PATTERN.test('')).toBe(false);
  });
});

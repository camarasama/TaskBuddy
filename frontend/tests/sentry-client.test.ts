// Verifies the client-side Sentry init is DSN-guarded (no init without NEXT_PUBLIC_SENTRY_DSN).
describe('instrumentation-client - Sentry DSN guard', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('does NOT initialize Sentry when NEXT_PUBLIC_SENTRY_DSN is unset', () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const init = jest.fn();
    jest.doMock('@sentry/nextjs', () => ({ init, captureRouterTransitionStart: jest.fn() }));

    require('../src/instrumentation-client');

    expect(init).not.toHaveBeenCalled();
  });

  it('initializes Sentry with the DSN when NEXT_PUBLIC_SENTRY_DSN is set', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const init = jest.fn();
    jest.doMock('@sentry/nextjs', () => ({ init, captureRouterTransitionStart: jest.fn() }));

    require('../src/instrumentation-client');

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' }),
    );
  });
});

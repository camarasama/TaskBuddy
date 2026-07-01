describe('instrument.ts - Sentry DSN guard', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('does NOT initialize Sentry when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const init = jest.fn();
    jest.doMock('@sentry/node', () => ({ init }));
    require('../src/instrument');
    expect(init).not.toHaveBeenCalled();
  });

  it('initializes Sentry with the DSN when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const init = jest.fn();
    jest.doMock('@sentry/node', () => ({ init }));
    require('../src/instrument');
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' }),
    );
  });
});

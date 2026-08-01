/**
 * The reporting seam.
 *
 * Small surface, but two of its properties are the kind that only matter when something is already
 * going wrong — which is the worst time to discover they do not hold.
 */

describe('reportError', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* eslint-disable @typescript-eslint/no-require-imports */
  function load() {
    return require('../reporting') as typeof import('../reporting');
  }

  /**
   * `config.ts` reads the manifest once at module scope, so the DSN can only be varied by re-mocking
   * `expo-constants` and re-requiring — hence `jest.resetModules()` in `beforeEach`. Sentry is fetched
   * in the same cycle because a module reset hands back fresh `jest.fn()`s.
   */
  function loadWith(dsn?: string) {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: {
            apiUrl: 'https://api.invalid/api/v1',
            clientPlatform: 'taskbuddy-android',
            clientVersion: '0.1.0',
            ...(dsn === undefined ? {} : { sentryDsn: dsn }),
          },
        },
      },
    }));
    return {
      reporting: require('../reporting') as typeof import('../reporting'),
      Sentry: require('@sentry/react-native') as typeof import('@sentry/react-native'),
    };
  }

  it('records the error with its context', () => {
    const reporting = load();

    reporting.reportError(new TypeError('boom'), 'api.refresh');

    const [entry] = reporting.recentErrors();
    expect(entry.message).toBe('TypeError: boom');
    expect(entry.context).toBe('api.refresh');
  });

  it('handles a thrown non-Error without choking', () => {
    // Plenty of code throws strings, and a reporter that assumes `.message` exists would throw while
    // reporting — turning a handled problem into a crash.
    const reporting = load();

    reporting.reportError('just a string');

    expect(reporting.recentErrors()[0].message).toBe('just a string');
  });

  it('never throws, whatever it is handed', () => {
    const reporting = load();
    const hostile = {
      get message() {
        throw new Error('nope');
      },
    };

    expect(() => reporting.reportError(hostile)).not.toThrow();
  });

  it('bounds the buffer so a failure loop cannot grow it without limit', () => {
    // A request retrying against a dead server can report continuously; this must not become the
    // reason the app runs out of memory.
    const reporting = load();

    for (let i = 0; i < 50; i++) reporting.reportError(new Error(`e${i}`));

    const recent = reporting.recentErrors();
    expect(recent.length).toBeLessThanOrEqual(20);
    // Newest kept, oldest dropped.
    expect(recent[recent.length - 1].message).toBe('Error: e49');
  });

  it('initReporting is safe to call', () => {
    const reporting = load();
    expect(() => reporting.initReporting()).not.toThrow();
  });

  describe('Sentry', () => {
    it('does not initialise without a DSN', () => {
      // The documented off switch. An unset DSN must mean no init, no events, no network — the same
      // contract as backend/src/instrument.ts, and what keeps local runs and forks out of our project.
      const { reporting, Sentry } = loadWith(undefined);

      reporting.initReporting();

      expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('initialises once with a DSN, however many times it is called', () => {
      const { reporting, Sentry } = loadWith('https://key@o1.ingest.sentry.io/2');

      reporting.initReporting();
      reporting.initReporting();
      reporting.reportError(new Error('boom'));

      expect(Sentry.init).toHaveBeenCalledTimes(1);
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://key@o1.ingest.sentry.io/2',
          // Children's app: Families policy makes this one worth pinning, not just documenting.
          sendDefaultPii: false,
        }),
      );
    });

    it('forwards the error, tagged with its context', () => {
      const { reporting, Sentry } = loadWith('https://key@o1.ingest.sentry.io/2');
      const error = new TypeError('boom');

      reporting.reportError(error, 'api.refresh');

      expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { context: 'api.refresh' } });
    });

    it('initialises lazily, so a first-render crash is not lost', () => {
      // `initReporting()` runs from an effect in the root layout, which has NOT happened during the
      // first render — exactly when a render crash reaches the root ErrorBoundary. Reporting without
      // an initialised Sentry would drop precisely the crashes worth having.
      const { reporting, Sentry } = loadWith('https://key@o1.ingest.sentry.io/2');

      reporting.reportError(new Error('during first render'), 'render');

      expect(Sentry.init).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalled();
    });

    it('still records, and does not throw, when Sentry itself fails', () => {
      // Reporting is the one path that must never take the app down with it.
      const { reporting, Sentry } = loadWith('https://key@o1.ingest.sentry.io/2');
      (Sentry.captureException as jest.Mock).mockImplementation(() => {
        throw new Error('transport is down');
      });

      expect(() => reporting.reportError(new Error('boom'), 'api')).not.toThrow();
      expect(reporting.recentErrors()[0].message).toBe('Error: boom');
    });
  });
});

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
});

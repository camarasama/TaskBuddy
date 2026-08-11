/**
 * The component stack must survive the trip from the boundary that has it to the one that reports it.
 *
 * `TypeError: i is not a function` on `/child/tasks` arrived in Sentry with a stack made entirely of
 * React reconciler frames: an effect cleanup that was not a function, called from
 * `commitHookEffectListUnmount`. Nothing in that trace named a component, because by then the app
 * frames were gone. React does hand over the component stack, but only to a class boundary's
 * `componentDidCatch` — and Next's own boundary passes `global-error.tsx` the error alone.
 *
 * These tests cover the three assumptions the fix rests on: the association survives, it is not
 * written onto the error object, and Sentry's stack parser can actually read React's format (which
 * is what makes the frames resolve against the uploaded source maps rather than staying minified).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { componentStackOf, rememberComponentStack } from '../src/lib/componentStack';

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

/** The shape React produces: V8 frame syntax, innermost component first. */
const REACT_COMPONENT_STACK = `
    at TaskCommentThread (https://app.gettaskbuddy.com/_next/static/chunks/page-abc.js:1:4210)
    at div
    at TaskCard (https://app.gettaskbuddy.com/_next/static/chunks/page-abc.js:1:9105)
    at ChildTasksPage (https://app.gettaskbuddy.com/_next/static/chunks/page-abc.js:1:12880)`;

describe('componentStack association', () => {
  it('gives back the stack that was recorded against an error', () => {
    const error = new Error('boom');
    rememberComponentStack(error, REACT_COMPONENT_STACK);

    expect(componentStackOf(error)).toBe(REACT_COMPONENT_STACK);
  });

  it('keeps the stack off the error object, which is logged and serialised elsewhere', () => {
    // The error travels: Next logs it, and a server error is serialised into a `digest`. Diagnostic
    // text hung on it as a property could end up somewhere a user sees.
    const error = new Error('boom');
    rememberComponentStack(error, REACT_COMPONENT_STACK);

    expect(Object.keys(error)).toEqual([]);
    expect(JSON.stringify(error)).toBe('{}');
  });

  it('returns undefined for an error that never passed the boundary', () => {
    // Not every error goes through React. Reporting must not depend on this being present.
    expect(componentStackOf(new Error('thrown from a fetch handler'))).toBeUndefined();
  });

  it('ignores a non-object throw and an absent stack, rather than throwing while reporting a throw', () => {
    expect(() => rememberComponentStack('a string', REACT_COMPONENT_STACK)).not.toThrow();
    expect(() => rememberComponentStack(null, REACT_COMPONENT_STACK)).not.toThrow();
    expect(() => rememberComponentStack(new Error('x'), null)).not.toThrow();

    expect(componentStackOf('a string')).toBeUndefined();
    expect(componentStackOf(null)).toBeUndefined();
    expect(componentStackOf(new Error('x'))).toBeUndefined();
  });
});

describe('Sentry can read React component stacks', () => {
  it('parses component frames into file/line/column, which is what source maps resolve', () => {
    // The whole symbolicated half of the report rests on this: if the parser returned nothing, the
    // stack would stay in `contexts` as minified text and name no component.
    const { defaultStackParser } = require('@sentry/nextjs') as {
      defaultStackParser: (stack: string) => { filename?: string; function?: string; lineno?: number }[];
    };

    const frames = defaultStackParser(REACT_COMPONENT_STACK);

    // Sentry's own order, outermost first — the parser reverses React's, which is why nothing here
    // reverses it again.
    expect(frames.map((f) => f.function)).toEqual([
      'ChildTasksPage',
      'TaskCard',
      '?', // `at div`: a host element, which React writes without a location
      'TaskCommentThread',
    ]);

    const located = frames.filter((f) => typeof f.lineno === 'number');
    expect(located.length).toBe(3);
    expect(located.every((f) => f.filename?.startsWith('https://'))).toBe(true);
  });
});

describe('the reporter is actually wired up', () => {
  it('wraps the app, or nothing ever records a stack', () => {
    const providers = read('app', 'providers.tsx');

    expect(providers).toMatch(/import \{ ReactErrorReporter \}/);
    expect(providers).toMatch(/<ReactErrorReporter>\{children\}<\/ReactErrorReporter>/);
  });

  it('records the stack and, when it gives up, rethrows instead of rendering its own screen', () => {
    // A fallback here would put "Something went wrong" in two files, and the two would drift.
    const reporter = read('components', 'ReactErrorReporter.tsx');

    expect(reporter).toMatch(/componentDidCatch/);
    expect(reporter).toMatch(/rememberComponentStack\(error, errorInfo\.componentStack\)/);
    expect(reporter).toMatch(/throw this\.state\.error/);
  });

  it('retries a failure once before escalating, and refills the budget after a quiet period', () => {
    // This is what tells a discarded tree's bad effect cleanup — which does not recur — apart from a
    // real render error, which throws again on the very next render. Without the cap, a render error
    // would retry forever.
    const reporter = read('components', 'ReactErrorReporter.tsx');

    expect(reporter).toMatch(/MAX_CONSECUTIVE_RECOVERIES/);
    expect(reporter).toMatch(/if \(this\.consecutive >= MAX_CONSECUTIVE_RECOVERIES\) \{\s*\n[\s\S]{0,400}?return;/);
    expect(reporter).toMatch(/this\.setState\(\{ error: null \}\)/);
    expect(reporter).toMatch(/RECOVERY_RESET_MS/);
  });

  it('reports a recovered crash too, or the mitigation would hide the bug it mitigates', () => {
    const reporter = read('components', 'ReactErrorReporter.tsx');

    expect(reporter).toMatch(/reportReactError\(error, \{ recovered: true \}\)/);
  });

  it('attaches the stack where Sentry symbolicates it, and not where Sentry groups on it', () => {
    // `exception.values` is the grouping key: adding a value there would fork this crash into a new
    // issue on the deploy that added the instrumentation and lose its history. `threads` is not.
    const reporter = read('lib', 'reportError.ts');

    expect(reporter).toMatch(/componentStackOf\(error\)/);
    expect(reporter).toMatch(/setContext\('react', \{ componentStack \}\)/);
    expect(reporter).toMatch(/event\.threads = \{/);
    expect(reporter).not.toMatch(/exception\.values\.push/);
  });

  it('separates a recovered crash from a fatal one, which are different bugs with the same stack', () => {
    const reporter = read('lib', 'reportError.ts');
    const globalError = read('app', 'global-error.tsx');

    expect(reporter).toMatch(/setTag\('react\.recovered'/);
    // global-error only runs when recovery gave up, so its report is the fatal one.
    expect(globalError).toMatch(/reportReactError\(error\)/);
  });
});

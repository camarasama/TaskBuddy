/**
 * utils/zodV3Messages.ts - zod 3's wording for zod 4's default validation messages (2026-10-27).
 *
 * The web and Android apps show validation errors to people. zod 4 rewrote every default message
 * ("Required" became "Invalid input: expected string, received undefined"), so the backend and the
 * web app both install this as zod's global `customError`. It lives here so the two can never
 * drift, and it takes a plain issue object so shared needs no zod dependency.
 *
 * Returns undefined for anything not covered, which makes zod fall back to its own message. A
 * schema's own `message`/`error` always wins over this. Wording captured from zod 3.25.76 and
 * pinned by backend/tests/zod-v3-messages.test.ts.
 */

/** The fields of a zod 4 issue this reads. */
export interface ZodIssueLike {
  code: string;
  input?: unknown;
  expected?: unknown;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
  format?: string;
  values?: unknown[];
}

function received(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}

export function v3Message(iss: ZodIssueLike): string | undefined {
  const i = iss as ZodIssueLike & Record<string, unknown>;
  switch (iss.code) {
    case 'invalid_type':
      if (i.input === undefined) return 'Required';
      return `Expected ${String(i.expected)}, received ${received(i.input)}`;
    case 'too_small': {
      const n = Number(i.minimum);
      const incl = i.inclusive !== false;
      if (i.origin === 'string') return `String must contain at least ${n} character(s)`;
      if (i.origin === 'array' || i.origin === 'set') return `Array must contain at least ${n} element(s)`;
      if (i.origin === 'number' || i.origin === 'int' || i.origin === 'bigint') {
        return `Number must be greater than ${incl ? 'or equal to ' : ''}${n}`;
      }
      return undefined;
    }
    case 'too_big': {
      const n = Number(i.maximum);
      const incl = i.inclusive !== false;
      if (i.origin === 'string') return `String must contain at most ${n} character(s)`;
      if (i.origin === 'array' || i.origin === 'set') return `Array must contain at most ${n} element(s)`;
      if (i.origin === 'number' || i.origin === 'int' || i.origin === 'bigint') {
        return `Number must be less than ${incl ? 'or equal to ' : ''}${n}`;
      }
      return undefined;
    }
    case 'invalid_format': {
      const f = String(i.format);
      if (f === 'email') return 'Invalid email';
      if (f === 'uuid' || f === 'guid') return 'Invalid uuid';
      if (f === 'url') return 'Invalid url';
      if (f === 'datetime') return 'Invalid datetime';
      if (f === 'date') return 'Invalid date';
      if (f === 'regex') return 'Invalid';
      return undefined;
    }
    case 'invalid_value': {
      const values = (i.values as unknown[] | undefined) ?? [];
      if (values.length === 1) return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      return `Invalid enum value. Expected ${values.map((v) => `'${String(v)}'`).join(' | ')}, received '${String(i.input)}'`;
    }
    default:
      return undefined;
  }
}

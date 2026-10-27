/**
 * zod 4 keeps zod 3's default validation wording (utils/zodMessages.ts, 2026-10-27).
 *
 * The web app and the Android app show these to people as "field: message". The expected strings
 * below were captured from zod 3.25.76 itself, side by side with zod 4 + the map, before the
 * migration. If a zod upgrade changes the issue shape, this fails instead of the apps quietly
 * showing "Invalid input: expected string, received undefined".
 */

import { z } from 'zod';
import '../src/utils/zodMessages';

const cases: Array<[string, z.ZodType, unknown, string]> = [
  ['missing field', z.object({ a: z.string() }), {}, 'Required'],
  ['wrong type', z.object({ a: z.string() }), { a: 5 }, 'Expected string, received number'],
  ['string min', z.string().min(2), 'a', 'String must contain at least 2 character(s)'],
  ['string max', z.string().max(3), 'abcd', 'String must contain at most 3 character(s)'],
  ['array min', z.array(z.string()).min(1), [], 'Array must contain at least 1 element(s)'],
  ['array max', z.array(z.string()).max(1), ['a', 'b'], 'Array must contain at most 1 element(s)'],
  ['number min', z.number().min(1), 0, 'Number must be greater than or equal to 1'],
  ['number max', z.number().max(5), 6, 'Number must be less than or equal to 5'],
  ['number gt', z.number().gt(1), 1, 'Number must be greater than 1'],
  ['email', z.string().email(), 'x', 'Invalid email'],
  ['uuid', z.string().uuid(), 'x', 'Invalid uuid'],
  ['url', z.string().url(), 'x', 'Invalid url'],
  ['datetime', z.string().datetime(), 'x', 'Invalid datetime'],
  ['regex', z.string().regex(/^a$/), 'b', 'Invalid'],
  ['enum', z.enum(['a', 'b']), 'c', "Invalid enum value. Expected 'a' | 'b', received 'c'"],
  ['literal', z.literal(true), false, 'Invalid literal value, expected true'],
];

it.each(cases)('%s keeps the zod 3 wording', (_name, schema, input, expected) => {
  const res = schema.safeParse(input);
  expect(res.success).toBe(false);
  expect(res.error!.issues[0].message).toBe(expected);
});

it('a schema-specific message still wins over the global map', () => {
  const res = z.string().min(2, { message: 'Name too short' }).safeParse('a');
  expect(res.error!.issues[0].message).toBe('Name too short');
});

it('the parental consent literal keeps its own message', () => {
  const res = z.literal(true, { error: 'Parental consent must be given before adding a child' }).safeParse(false);
  expect(res.error!.issues[0].message).toBe('Parental consent must be given before adding a child');
});

/**
 * Count plus correctly pluralised noun.
 *
 * Exists because "1 tasks done" and "Best streak: 1 days" both shipped and were spotted in a
 * screenshot on the first real use. Individually trivial; together they are the difference between an
 * app that reads as finished and one that reads as a prototype — and children notice this sort of
 * thing more than adults do, not less.
 *
 * English-only and deliberately simple: it appends `s`, or takes an explicit plural for the irregular
 * cases. When FR-16 (i18n) lands this becomes a call into the translation layer's plural rules, which
 * is exactly why every call site routes through one function now rather than concatenating inline.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const noun = count === 1 ? singular : (pluralForm ?? `${singular}s`);
  return `${count} ${noun}`;
}

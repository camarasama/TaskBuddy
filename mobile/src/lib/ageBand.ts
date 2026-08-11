/**
 * Which visual treatment a child's dashboard gets.
 *
 * ## Why two treatments and not one "more colourful" design
 *
 * The brief asked for a dashboard that is more joyful for the child audience. That audience is 10 to
 * 16, which is not one audience. What delights a 10-year-old reads as babyish to a 16-year-old, and
 * the 16-year-olds are the ones who quit — a child who feels the app is for little kids stops opening
 * it, and no amount of colour fixes that. So the same information gets two presentations.
 *
 * Both are built from the existing palette in `shared/src/design/tokens.ts`. Nothing here invents a
 * second design system: the difference is emphasis, saturation and wording, not new brand colours.
 *
 * ## Derived from the birth date, not the stored bucket
 *
 * `ChildProfile.ageGroup` is a stored string that was correct when it was written. A child who has
 * had a birthday since is in the wrong bucket until something rewrites it, and being addressed as a
 * younger child on your 13th birthday is precisely the failure this split exists to avoid. The date
 * of birth cannot go stale, so it wins when present; `ageGroup` is the fallback.
 *
 * With neither, the calmer treatment is the default. Mistakenly showing a 10-year-old the plainer
 * screen costs some delight; mistakenly showing a 16-year-old the playful one costs the user.
 */
import { AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';

export type AgeBand = 'younger' | 'older';

/** The boundary. 10 to 12 is the playful treatment, 13 to 16 the composed one. */
export const YOUNGER_BAND_MAX = 12;

export function resolveAgeBand(input: {
  dateOfBirth?: string | Date | null;
  ageGroup?: string | null;
}): AgeBand {
  const { dateOfBirth, ageGroup } = input;

  if (dateOfBirth) {
    // A single call rather than computing an age: the boundary cases (a birthday today, 29 February)
    // are already solved once in shared, and this is not the place to solve them a second time.
    return isAgeBetween(dateOfBirth, AGE_LIMITS.CHILD_MIN, YOUNGER_BAND_MAX) ? 'younger' : 'older';
  }

  if (ageGroup === '10-12') return 'younger';
  return 'older';
}

/**
 * Copy that differs by band.
 *
 * Kept here rather than inline so the two voices can be read side by side. It is very easy to write
 * one warm line for the younger band and leave the older band with system text, which reads as the
 * app caring less about them.
 */
export const BAND_COPY: Record<AgeBand, { greeting: (name: string) => string; todayLabel: string; emptyToday: string }> = {
  younger: {
    greeting: (name) => `Hi ${name}!`,
    todayLabel: "Today's missions",
    emptyToday: 'Nothing to do right now. Go and enjoy your day!',
  },
  older: {
    greeting: (name) => `Hey ${name}`,
    todayLabel: 'Today',
    emptyToday: "You're all clear for today.",
  },
};

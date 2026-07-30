/**
 * Maths question banks — Phase D content, first category.
 *
 * ## Scope
 *
 * `maths / beginner` already exists as "Math Challenge" (25 questions, seeded before the redesign), so
 * only the two missing levels are authored here. Content lives in `src/content/games/` rather than in
 * `gamesSeed.ts` because eighteen banks in one route file is unreadable; `gamesSeed` imports from here.
 *
 * ## How these were written, and what to check
 *
 * Rules applied to every question:
 *
 *  - **Exactly one defensible answer.** No "which is best" or "roughly". Every distractor is wrong under
 *    any reasonable reading.
 *  - **Distractors are plausible.** Each is the result of a specific likely mistake — forgetting BODMAS,
 *    dividing instead of multiplying, using diameter for radius — rather than a random number. A child
 *    who guesses should not be able to eliminate three options on sight.
 *  - **No currency and no local units.** The app has users in more than one country; "40" is a quantity,
 *    not a sum of money. Metric throughout.
 *  - **Answer positions vary.** Options are also shuffled per session from the session id, but writing
 *    every answer at index 1 would still bias the bank if that ever changed.
 *  - **Reading level below the maths level.** A hard maths question should be hard because of the maths,
 *    not because a 10-year-old cannot parse the sentence.
 *
 * The maths is checkable and I have checked it, but this is children's educational content: the value of
 * a second pair of eyes is in the *tiering* — whether beginner/intermediate/hard actually feel like three
 * distinct steps for a 10–16 year old — more than in the arithmetic.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/**
 * Intermediate: percentages, ratio, area and perimeter, negatives, order of operations, averages, and
 * one-step algebra. Roughly upper primary to early secondary.
 */
export const MATHS_INTERMEDIATE: SeedQuestion[] = [
  { id: 'mi01', text: 'What is 15% of 200?', options: ['25', '30', '35', '40'], correctIndex: 1 },
  // Distractor 11 is "subtract 5 then divide by nothing"; 15 is "20 minus 5".
  { id: 'mi02', text: 'Solve for x: 3x + 5 = 20', options: ['3', '5', '11', '15'], correctIndex: 1 },
  // 26 is the perimeter — the classic area/perimeter mix-up.
  { id: 'mi03', text: 'A rectangle is 7 cm long and 6 cm wide. What is its area?', options: ['13 cm²', '26 cm²', '42 cm²', '36 cm²'], correctIndex: 2 },
  { id: 'mi04', text: 'What is −8 + 15?', options: ['−23', '−7', '7', '23'], correctIndex: 2 },
  // 30 is what you get by working strictly left to right.
  { id: 'mi05', text: 'What is 6 + 4 × 3?', options: ['18', '22', '30', '42'], correctIndex: 0 },
  { id: 'mi06', text: 'What is the mean of 4, 8, 6 and 10?', options: ['6', '7', '8', '9'], correctIndex: 1 },
  { id: 'mi07', text: 'Write the ratio 12 : 18 in its simplest form.', options: ['2 : 3', '3 : 4', '4 : 6', '6 : 9'], correctIndex: 0 },
  // 81 is the area rather than the perimeter.
  { id: 'mi08', text: 'What is the perimeter of a square with sides of 9 cm?', options: ['18 cm', '27 cm', '36 cm', '81 cm'], correctIndex: 2 },
  { id: 'mi09', text: 'What is 3/4 written as a percentage?', options: ['34%', '60%', '75%', '80%'], correctIndex: 2 },
  { id: 'mi10', text: 'What is 144 ÷ 12?', options: ['10', '11', '12', '14'], correctIndex: 2 },
  { id: 'mi11', text: 'What is 2.5 × 4?', options: ['8', '9', '10', '12'], correctIndex: 2 },
  // 10 is the discount itself rather than the new price.
  { id: 'mi12', text: 'A jacket costs 40 and is reduced by 25%. What is the new price?', options: ['10', '15', '30', '35'], correctIndex: 2 },
  // 10 is 5 × 2 — the common "squared means doubled" error.
  { id: 'mi13', text: 'What is 5²?', options: ['10', '25', '50', '55'], correctIndex: 1 },
  { id: 'mi14', text: 'Which of these fractions is the largest?', options: ['1/2', '2/5', '3/8', '4/9'], correctIndex: 0 },
  // 6/10 is correct but not simplified; the question asks for simplest form.
  { id: 'mi15', text: 'Write 0.6 as a fraction in its simplest form.', options: ['6/10', '3/5', '2/3', '1/6'], correctIndex: 1 },
  { id: 'mi16', text: 'If 5 pens cost 30, how much do 8 pens cost?', options: ['40', '45', '48', '50'], correctIndex: 2 },
  { id: 'mi17', text: 'What is 20% of 90?', options: ['14', '18', '20', '22'], correctIndex: 1 },
  { id: 'mi18', text: 'The angles inside a triangle always add up to how many degrees?', options: ['90', '180', '270', '360'], correctIndex: 1 },
  { id: 'mi19', text: 'What is 7 × 12?', options: ['74', '82', '84', '96'], correctIndex: 2 },
  // 9a is what you get by adding all three terms and ignoring the minus.
  { id: 'mi20', text: 'Simplify: 4a + 3a − 2a', options: ['5a', '7a', '9a', '3a'], correctIndex: 0 },
];

/**
 * Hard: two-step algebra, indices and roots, probability, circle area, compound percentage change,
 * sequences and interior angles. Roughly mid to upper secondary.
 */
export const MATHS_HARD: SeedQuestion[] = [
  // 7 comes from dividing before expanding; 17 from adding 3 instead of subtracting.
  { id: 'mh01', text: 'Solve for x: 2(x − 3) = 14', options: ['7', '10', '11', '17'], correctIndex: 1 },
  // 72 is 144 ÷ 2 — square root confused with halving.
  { id: 'mh02', text: 'What is √144?', options: ['11', '12', '14', '72'], correctIndex: 1 },
  // 10 is 2 × 5 — index confused with multiplication.
  { id: 'mh03', text: 'What is 2⁵?', options: ['10', '16', '32', '64'], correctIndex: 2 },
  // 3/5 uses the wrong denominator (reds over blues instead of over the total).
  { id: 'mh04', text: 'A bag holds 3 red balls and 5 blue balls. What is the probability of drawing a red one?', options: ['3/5', '3/8', '5/8', '1/3'], correctIndex: 1 },
  // 540 is the pentagon answer — off by one side.
  { id: 'mh05', text: 'What do the interior angles of a hexagon add up to?', options: ['360°', '540°', '720°', '900°'], correctIndex: 2 },
  { id: 'mh06', text: 'What comes next: 2, 6, 12, 20, 30, …?', options: ['36', '40', '42', '44'], correctIndex: 2 },
  // x¹² comes from multiplying the indices instead of adding them.
  { id: 'mh07', text: 'Simplify: x³ × x⁴', options: ['x⁷', 'x¹²', 'x¹', 'x⁶'], correctIndex: 0 },
  // 675 is 45 increased by 15× ; 6.75 thinking inverted.
  { id: 'mh08', text: '15% of a number is 45. What is the number?', options: ['60', '150', '300', '675'], correctIndex: 2 },
  // 3/8 is what you get by multiplying instead of inverting the second fraction.
  { id: 'mh09', text: 'What is 3/4 ÷ 1/2?', options: ['3/8', '3/2', '2/3', '1/4'], correctIndex: 1 },
  { id: 'mh10', text: 'Expand: (x + 3)(x + 2)', options: ['x² + 6x + 5', 'x² + 5x + 6', 'x² + 5x + 5', 'x² + 6'], correctIndex: 1 },
  // The intuitive answer is "the same"; it is not, and that is the point of the question.
  { id: 'mh11', text: 'A price goes up by 10%, then down by 10%. Compared with the start, it is now:', options: ['The same', 'Slightly higher', 'Slightly lower', 'Twice as much'], correctIndex: 2 },
  // −4 is the common reading of a negative index as a negative number.
  { id: 'mh12', text: 'What is 4⁻¹?', options: ['−4', '1/4', '−1/4', '0'], correctIndex: 1 },
  // 31.4 is the circumference; 157 uses the diameter as the radius.
  { id: 'mh13', text: 'What is the area of a circle with radius 5? (use π ≈ 3.14)', options: ['31.4', '78.5', '15.7', '157'], correctIndex: 1 },
  { id: 'mh14', text: 'Solve for x: x/3 + 2 = 7', options: ['9', '15', '21', '27'], correctIndex: 1 },
  // 9 is the middle of the unsorted list — the classic median mistake.
  { id: 'mh15', text: 'What is the median of 3, 7, 9, 4 and 11?', options: ['6', '7', '8', '9'], correctIndex: 1 },
  { id: 'mh16', text: 'Two angles in a triangle are 55° and 65°. What is the third?', options: ['50°', '60°', '70°', '80°'], correctIndex: 1 },
  // 9:12 is a valid simplification but not the simplest.
  { id: 'mh17', text: 'Write the ratio 45 : 60 in its simplest form.', options: ['3 : 4', '4 : 5', '9 : 12', '5 : 6'], correctIndex: 0 },
  { id: 'mh18', text: 'If 3x − 7 = 2x + 5, what is x?', options: ['2', '5', '12', '19'], correctIndex: 2 },
  // 50 is stopping after the first 10%.
  { id: 'mh19', text: 'What is 10% of 10% of 500?', options: ['0.5', '5', '50', '100'], correctIndex: 1 },
  // 54 is area plus width; 14 is length plus width without doubling.
  { id: 'mh20', text: 'A rectangle has an area of 48 and a width of 6. What is its perimeter?', options: ['14', '22', '28', '54'], correctIndex: 2 },
];

/**
 * Maths question banks — Phase D content, first category.
 *
 * ## Scope
 *
 * All three levels live here, in one file per category — `gamesSeed.ts` imports them. They were split
 * across two files at first (beginner inline in the seed, the rest here) and that split immediately hid a
 * real bug: the cross-level duplicate check could not see the beginner bank, so two questions were
 * duplicated between beginner and intermediate and two more were the same question reworded. One file per
 * category is what makes that check possible at all.
 *
 * `maths / beginner` is the pre-existing "Math Challenge" bank, moved verbatim — see the warning on it.
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
 * Beginner — the ORIGINAL "Math Challenge" bank, moved here verbatim from `gamesSeed.ts`.
 *
 * ⚠️ **This bank predates the level system and is not really a beginner tier.** It was authored as one
 * general mixed quiz, so it contains percentages, indices, square roots, order of operations, area,
 * perimeter, sequences and angle sums — material that belongs at intermediate. It is preserved exactly
 * as-is because these rows are live: children have played them, `GameQuestionSeen` references their ids,
 * and `backfillGameBanks` matches on id AND normalised text, so editing either would change behaviour
 * against real history.
 *
 * Re-tiering it needs an owner decision and a content-replacement path, not a seed edit — `seedGames()`
 * skips definitions that already exist, so nothing here reaches an existing deployment anyway.
 */
export const MATHS_BEGINNER: SeedQuestion[] = [
  { id: 'm01', text: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
  { id: 'm02', text: 'What is 144 ÷ 12?', options: ['10', '11', '12', '13'], correctIndex: 2 },
  { id: 'm06', text: 'What is 9 × 6?', options: ['45', '54', '56', '63'], correctIndex: 1 },
  { id: 'm07', text: 'What is 100 − 37?', options: ['53', '63', '67', '73'], correctIndex: 1 },
  { id: 'm08', text: 'What is 25 × 4?', options: ['75', '90', '100', '125'], correctIndex: 2 },
  { id: 'm09', text: 'What is 3/4 as a decimal?', options: ['0.25', '0.5', '0.75', '0.8'], correctIndex: 2 },
  { id: 'm10', text: 'What is the perimeter of a square with sides of 5 cm?', options: ['10 cm', '15 cm', '20 cm', '25 cm'], correctIndex: 2 },
  { id: 'm11', text: 'What is 12 × 12?', options: ['124', '132', '144', '156'], correctIndex: 2 },
  { id: 'm12', text: 'How many minutes are in 2½ hours?', options: ['120', '140', '150', '160'], correctIndex: 2 },
  { id: 'm13', text: 'What is 50% of 90?', options: ['35', '40', '45', '50'], correctIndex: 2 },
  { id: 'm15', text: 'What is the next number: 2, 4, 8, 16, …?', options: ['20', '24', '32', '18'], correctIndex: 2 },
  { id: 'm16', text: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correctIndex: 1 },
  { id: 'm17', text: 'What is 81 ÷ 9?', options: ['7', '8', '9', '11'], correctIndex: 2 },
  { id: 'm18', text: 'What is the area of a rectangle 6 cm by 4 cm?', options: ['10 cm²', '20 cm²', '24 cm²', '26 cm²'], correctIndex: 2 },
  { id: 'm19', text: 'Round 6.7 to the nearest whole number.', options: ['6', '7', '6.5', '8'], correctIndex: 1 },
  { id: 'm20', text: 'What is 1000 − 250?', options: ['650', '700', '750', '850'], correctIndex: 2 },
  { id: 'm21', text: 'How many degrees are in a right angle?', options: ['45', '90', '180', '360'], correctIndex: 1 },
  { id: 'm22', text: 'What is 6 × 7 + 3?', options: ['42', '45', '48', '63'], correctIndex: 1 },
  { id: 'm23', text: 'Which fraction is largest?', options: ['1/2', '1/3', '1/4', '1/5'], correctIndex: 0 },
  { id: 'm25', text: 'How many degrees are in a triangle’s three angles?', options: ['90', '180', '270', '360'], correctIndex: 1 },
  // ── Added when the bank was re-tiered as a genuine beginner level ──────────
  { id: 'mb01', text: 'What is 6 × 8?', options: ['48', '42', '46', '54'], correctIndex: 0 },
  { id: 'mb02', text: 'What is 45 + 38?', options: ['73', '83', '85', '93'], correctIndex: 1 },
  { id: 'mb03', text: 'What is half of 96?', options: ['46', '52', '48', '58'], correctIndex: 2 },
  { id: 'mb04', text: 'How many centimetres are in 2 metres?', options: ['20 cm', '100 cm', '2000 cm', '200 cm'], correctIndex: 3 },
  { id: 'mb05', text: 'What is 1/4 of 40?', options: ['10', '4', '8', '20'], correctIndex: 0 },
  { id: 'mb06', text: 'Which of these numbers is even?', options: ['17', '34', '23', '41'], correctIndex: 1 },
  { id: 'mb07', text: 'What is 200 ÷ 4?', options: ['40', '45', '50', '60'], correctIndex: 2 },
  { id: 'mb08', text: 'How many days are in a leap year?', options: ['364', '365', '367', '366'], correctIndex: 3 },
  { id: 'mb09', text: 'What is the next number: 5, 10, 15, 20, …?', options: ['25', '22', '24', '30'], correctIndex: 0 },
  { id: 'mb10', text: 'What is 7 × 9?', options: ['54', '63', '56', '72'], correctIndex: 1 },
];

/**
 * Intermediate: percentages, ratio, area and perimeter, negatives, order of operations, averages, and
 * one-step algebra. Roughly upper primary to early secondary.
 */
export const MATHS_INTERMEDIATE: SeedQuestion[] = [
  // 24 is 30% and 32 is 40% — near misses that punish estimating rather than calculating.
  { id: 'mi01', text: 'What is 35% of 80?', options: ['24', '26', '28', '32'], correctIndex: 2 },
  // Distractor 11 is "subtract 5 then divide by nothing"; 15 is "20 minus 5".
  { id: 'mi02', text: 'Solve for x: 3x + 5 = 20', options: ['3', '5', '11', '15'], correctIndex: 1 },
  // Work backwards from the area — beginner asks for area directly, so this is a genuine step up.
  // 48 is 56 − 8, the usual slip when the operation is misremembered as subtraction.
  { id: 'mi03', text: 'A rectangle has an area of 56 cm² and a length of 8 cm. What is its width?', options: ['6 cm', '7 cm', '8 cm', '48 cm'], correctIndex: 1 },
  { id: 'mi04', text: 'What is −8 + 15?', options: ['−23', '−7', '7', '23'], correctIndex: 2 },
  // 30 is what you get by working strictly left to right.
  { id: 'mi05', text: 'What is 6 + 4 × 3?', options: ['18', '22', '30', '42'], correctIndex: 0 },
  { id: 'mi06', text: 'What is the mean of 4, 8, 6 and 10?', options: ['6', '7', '8', '9'], correctIndex: 1 },
  { id: 'mi07', text: 'Write the ratio 12 : 18 in its simplest form.', options: ['2 : 3', '3 : 4', '4 : 6', '6 : 9'], correctIndex: 0 },
  // Again work backwards. 15 is halving the perimeter without subtracting the width; 24 is 30 − 6.
  { id: 'mi08', text: 'A rectangle has a perimeter of 30 cm and a width of 6 cm. What is its length?', options: ['9 cm', '12 cm', '15 cm', '24 cm'], correctIndex: 0 },
  { id: 'mi09', text: 'What is 3/4 written as a percentage?', options: ['34%', '60%', '75%', '80%'], correctIndex: 2 },
  // 400 scales by nothing; 500 rounds the wrong way. Proportional reasoning, not division practice.
  { id: 'mi10', text: 'A recipe for 4 people uses 300 g of rice. How much is needed for 6 people?', options: ['400 g', '420 g', '450 g', '500 g'], correctIndex: 2 },
  { id: 'mi11', text: 'What is 2.5 × 4?', options: ['8', '9', '10', '12'], correctIndex: 2 },
  // 10 is the discount itself rather than the new price.
  { id: 'mi12', text: 'A jacket costs 40 and is reduced by 25%. What is the new price?', options: ['10', '15', '30', '35'], correctIndex: 2 },
  // 10 is 5 × 2 — the common "squared means doubled" error.
  { id: 'mi13', text: 'What is 5²?', options: ['10', '25', '50', '55'], correctIndex: 1 },
  // Mixed decimals and fractions, so it cannot be answered by comparing denominators alone.
  { id: 'mi14', text: 'Which of these is the smallest?', options: ['0.35', '1/3', '3/8', '0.4'], correctIndex: 1 },
  // 6/10 is correct but not simplified; the question asks for simplest form.
  { id: 'mi15', text: 'Write 0.6 as a fraction in its simplest form.', options: ['6/10', '3/5', '2/3', '1/6'], correctIndex: 1 },
  { id: 'mi16', text: 'If 5 pens cost 30, how much do 8 pens cost?', options: ['40', '45', '48', '50'], correctIndex: 2 },
  { id: 'mi17', text: 'What is 20% of 90?', options: ['14', '18', '20', '22'], correctIndex: 1 },
  // 60 is base × height with the halving forgotten — by far the most common triangle-area error.
  { id: 'mi18', text: 'What is the area of a triangle with a base of 10 cm and a height of 6 cm?', options: ['16 cm²', '30 cm²', '36 cm²', '60 cm²'], correctIndex: 1 },
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

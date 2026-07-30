/**
 * Puzzle question banks — logic and pattern reasoning.
 *
 * Same shape and authoring rules as `maths.ts`, plus one that matters far more in this category than
 * anywhere else:
 *
 * **Every sequence has exactly ONE defensible rule.** "2, 4, 8, …" is a trap — it is ×2 (16) or +2,+4,+6
 * (14), and both are defensible, so a child who reasons correctly can still be marked wrong. Every
 * sequence here is either long enough to fix its rule unambiguously (four or five terms) or uses a named
 * series a distractor cannot fit. The distractors are the answers the OTHER plausible rules would give,
 * so the question tests whether the child found the rule rather than whether they guessed the author's.
 *
 * The classic lateral puzzles (the bat and ball, the snail in the well, "all but nine") are included
 * because their appeal is that the intuitive answer is wrong — and the intuitive answer is always
 * offered as a distractor, which is the whole point of them.
 *
 * No sequence here repeats one used in the maths banks.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Beginner: odd-one-out, simple alternating patterns, and one-step reasoning. */
export const PUZZLE_BEGINNER: SeedQuestion[] = [
  { id: 'pb01', text: 'Which shape has no corners?', options: ['Square', 'Triangle', 'Circle', 'Rectangle'], correctIndex: 2 },
  { id: 'pb02', text: 'Which is the odd one out among these living things?', options: ['Cat', 'Dog', 'Rose', 'Horse'], correctIndex: 2 },
  { id: 'pb03', text: 'What comes next: red, blue, red, blue, red, …?', options: ['Red', 'Blue', 'Green', 'Yellow'], correctIndex: 1 },
  { id: 'pb04', text: 'Which is the odd one out among these time words?', options: ['Monday', 'Tuesday', 'January', 'Friday'], correctIndex: 2 },
  { id: 'pb05', text: 'You are facing north and turn right. Which way are you facing now?', options: ['East', 'West', 'South', 'North'], correctIndex: 0 },
  { id: 'pb06', text: 'Which number is missing: 1, 2, 3, __, 5?', options: ['6', '4', '7', '0'], correctIndex: 1 },
  { id: 'pb07', text: 'Which is the odd one out among these foods?', options: ['Apple', 'Banana', 'Carrot', 'Orange'], correctIndex: 2 },
  { id: 'pb08', text: 'If today is Wednesday, what day is tomorrow?', options: ['Tuesday', 'Thursday', 'Friday', 'Monday'], correctIndex: 1 },
  { id: 'pb09', text: 'What comes next: A, B, C, D, …?', options: ['E', 'F', 'A', 'Z'], correctIndex: 0 },
  // The intuitive answer is "the stones"; they are the same by definition.
  { id: 'pb10', text: 'Which is heavier: 1 kg of feathers or 1 kg of stones?', options: ['The feathers', 'The stones', 'They weigh the same', 'It depends on the box'], correctIndex: 2 },
  { id: 'pb11', text: 'Which is the odd one out among these things?', options: ['Car', 'Bus', 'Train', 'Shoe'], correctIndex: 3 },
  { id: 'pb12', text: 'What comes next: 2, 4, 6, 8, …?', options: ['9', '10', '12', '16'], correctIndex: 1 },
  { id: 'pb13', text: 'All cats have tails. Tom is a cat. Does Tom have a tail?', options: ['Yes', 'No', 'Maybe', 'There is no way to tell'], correctIndex: 0 },
  { id: 'pb14', text: 'Which one does not belong?', options: ['Red', 'Blue', 'Loud', 'Green'], correctIndex: 2 },
  { id: 'pb15', text: 'What comes next: big, bigger, …?', options: ['Biggest', 'More big', 'Bigly', 'Bigness'], correctIndex: 0 },
  { id: 'pb16', text: 'A box holds 3 red balls and 2 blue balls. How many balls are there altogether?', options: ['4', '5', '6', '3'], correctIndex: 1 },
  { id: 'pb17', text: 'Which is the odd one out among these shapes?', options: ['Circle', 'Square', 'Triangle', 'Cube'], correctIndex: 3 },
  { id: 'pb18', text: 'You have 5 sweets and eat 2. How many are left?', options: ['2', '3', '5', '7'], correctIndex: 1 },
  { id: 'pb19', text: 'What comes next: Sunday, Monday, Tuesday, …?', options: ['Wednesday', 'Thursday', 'Saturday', 'Friday'], correctIndex: 0 },
  { id: 'pb20', text: 'Which is the odd one out among these objects?', options: ['Hammer', 'Saw', 'Bread', 'Screwdriver'], correctIndex: 2 },
];

/** Intermediate: analogies, rule-finding over four or more terms, and short deductions. */
export const PUZZLE_INTERMEDIATE: SeedQuestion[] = [
  { id: 'pi01', text: 'Bird is to nest as bee is to …?', options: ['Hive', 'Honey', 'Flower', 'Wing'], correctIndex: 0 },
  { id: 'pi02', text: 'What comes next: 3, 6, 9, 12, …?', options: ['14', '15', '16', '18'], correctIndex: 1 },
  { id: 'pi03', text: 'Doctor is to hospital as teacher is to …?', options: ['Book', 'School', 'Pupil', 'Lesson'], correctIndex: 1 },
  // Square numbers. 20 and 24 are what "add 4 each time" or "add 8" would give.
  { id: 'pi04', text: 'What comes next: 1, 4, 9, 16, …?', options: ['20', '25', '24', '36'], correctIndex: 1 },
  { id: 'pi05', text: 'A is taller than B, and B is taller than C. Who is shortest?', options: ['A', 'B', 'C', 'There is no way to tell'], correctIndex: 2 },
  { id: 'pi06', text: 'What comes next: Z, Y, X, W, …?', options: ['V', 'U', 'A', 'T'], correctIndex: 0 },
  { id: 'pi07', text: 'Puppy is to dog as kitten is to …?', options: ['Mouse', 'Fur', 'Cat', 'Milk'], correctIndex: 2 },
  { id: 'pi08', text: 'What comes next: 100, 90, 80, 70, …?', options: ['65', '60', '50', '75'], correctIndex: 1 },
  { id: 'pi09', text: 'Five people each shake hands with everyone else exactly once. How many handshakes happen?', options: ['10', '20', '25', '15'], correctIndex: 0 },
  { id: 'pi10', text: 'What is the missing number: 2, __, 8, 16, 32?', options: ['3', '4', '6', '5'], correctIndex: 1 },
  { id: 'pi11', text: 'Hot is to cold as day is to …?', options: ['Sun', 'Night', 'Morning', 'Light'], correctIndex: 1 },
  { id: 'pi12', text: 'Three people build a wall in 6 hours. Working at the same rate, how long would 6 people take?', options: ['3 hours', '12 hours', '9 hours', '6 hours'], correctIndex: 0 },
  // Fibonacci. 11 is what "add 3" would give from 8.
  { id: 'pi13', text: 'What comes next: 1, 1, 2, 3, 5, 8, …?', options: ['11', '13', '12', '10'], correctIndex: 1 },
  { id: 'pi14', text: 'Which does not belong?', options: ['Triangle', 'Pentagon', 'Hexagon', 'Sphere'], correctIndex: 3 },
  { id: 'pi15', text: 'A clock shows exactly 3 o’clock. What is the angle between the hands?', options: ['45°', '90°', '120°', '180°'], correctIndex: 1 },
  { id: 'pi16', text: 'What comes next: AB, CD, EF, …?', options: ['GH', 'FG', 'HI', 'GI'], correctIndex: 0 },
  { id: 'pi17', text: 'Yesterday was Friday. What day is the day after tomorrow?', options: ['Sunday', 'Monday', 'Tuesday', 'Saturday'], correctIndex: 1 },
  { id: 'pi18', text: 'Pen is to write as knife is to …?', options: ['Cut', 'Sharp', 'Kitchen', 'Metal'], correctIndex: 0 },
  { id: 'pi19', text: 'What comes next: 5, 10, 20, 40, …?', options: ['60', '80', '50', '100'], correctIndex: 1 },
  { id: 'pi20', text: 'A rope is cut into 4 pieces. How many cuts were made?', options: ['3', '4', '5', '2'], correctIndex: 0 },
];

/** Hard: named series, multi-step deduction, and the classics whose intuitive answer is wrong. */
export const PUZZLE_HARD: SeedQuestion[] = [
  // Cube numbers. 81 and 100 are what a squares-rule would suggest.
  { id: 'ph01', text: 'What comes next: 1, 8, 27, 64, …?', options: ['100', '125', '81', '128'], correctIndex: 1 },
  { id: 'ph02', text: 'All Bloops are Razzles. All Razzles are Lazzles. Are all Bloops Lazzles?', options: ['Yes', 'No', 'Only some of them', 'There is no way to tell'], correctIndex: 0 },
  { id: 'ph03', text: 'What comes next: 2, 3, 5, 7, 11, …?', options: ['12', '15', '14', '13'], correctIndex: 3 },
  // The famous one. Almost everyone answers 10; the ball is 5 and the bat 105.
  { id: 'ph04', text: 'A bat and a ball cost 110 together. The bat costs 100 more than the ball. How much is the ball?', options: ['10', '5', '15', '100'], correctIndex: 1 },
  { id: 'ph05', text: 'What comes next: 1, 2, 6, 24, 120, …?', options: ['600', '840', '720', '504'], correctIndex: 2 },
  // The intuitive answer is "first" — but you take the place of the person you passed.
  { id: 'ph06', text: 'In a race, you overtake the person in second place. What position are you in now?', options: ['First', 'Second', 'Third', 'There is no way to tell'], correctIndex: 1 },
  { id: 'ph07', text: 'What is the missing number: 4, 9, 16, __, 36?', options: ['20', '30', '25', '24'], correctIndex: 2 },
  // The intuitive answer is 100 minutes; the rate per machine never changes.
  { id: 'ph08', text: 'If 5 machines make 5 items in 5 minutes, how long do 100 machines take to make 100 items?', options: ['100 minutes', '5 minutes', '20 minutes', '1 minute'], correctIndex: 1 },
  { id: 'ph09', text: 'What comes next: J, F, M, A, M, …?', options: ['J', 'A', 'S', 'O'], correctIndex: 0 },
  { id: 'ph10', text: 'A cube is painted all over, then cut into 27 equal small cubes. How many small cubes have exactly 3 painted faces?', options: ['8', '12', '6', '1'], correctIndex: 0 },
  { id: 'ph11', text: 'What comes next: 3, 7, 15, 31, …?', options: ['47', '62', '55', '63'], correctIndex: 3 },
  { id: 'ph12', text: 'Two typists type two pages in two minutes. How many typists are needed to type 18 pages in six minutes?', options: ['6', '18', '9', '3'], correctIndex: 0 },
  // O-T-T-F-F-S-S: the first letters of one, two, three… so Eight is next.
  { id: 'ph13', text: 'What comes next: O, T, T, F, F, S, S, …?', options: ['E', 'N', 'T', 'S'], correctIndex: 0 },
  // "All but nine" means nine remain — the intuitive subtraction gives 8.
  { id: 'ph14', text: 'A farmer has 17 sheep. All but 9 run away. How many are left?', options: ['8', '9', '17', '0'], correctIndex: 1 },
  { id: 'ph15', text: 'This sequence describes itself: 1, 11, 21, 1211, … What comes next?', options: ['111221', '1231', '2211', '1112'], correctIndex: 0 },
  { id: 'ph16', text: 'How many squares of ANY size are there on an 8 × 8 chessboard?', options: ['64', '128', '100', '204'], correctIndex: 3 },
  { id: 'ph17', text: 'What comes next: 64, 32, 16, 8, …?', options: ['2', '6', '4', '0'], correctIndex: 2 },
  { id: 'ph18', text: 'Some Xs are Ys. All Ys are Zs. Must some Xs be Zs?', options: ['Yes', 'No', 'Only if X and Y are the same', 'There is no way to tell'], correctIndex: 0 },
  // Net gain is 1 m a day, but it escapes during the day it first reaches the top — day 8, not day 10.
  { id: 'ph19', text: 'A snail climbs 3 m up a 10 m well each day and slips back 2 m each night. On which day does it get out?', options: ['Day 10', 'Day 8', 'Day 9', 'Day 7'], correctIndex: 1 },
  { id: 'ph20', text: 'What comes next: 1, 4, 13, 40, …?', options: ['121', '120', '130', '118'], correctIndex: 0 },
];

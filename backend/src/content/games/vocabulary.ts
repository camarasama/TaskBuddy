/**
 * Vocabulary question banks.
 *
 * Same shape and authoring rules as `maths.ts` — see that file for the full set. Two rules matter more
 * here than elsewhere:
 *
 *  - **A word appears in this category once.** Asking "the opposite of ancient" at beginner and "a
 *    synonym for ancient" at intermediate would look like two questions and teach one word; the
 *    cross-level checks catch identical text but not that, so it is a discipline while writing.
 *  - **Definitions are the common ones, not the clever ones.** A child is being tested on the word, not
 *    on whether they share the author's taste in edge cases. Where a word has a shaded second meaning,
 *    the question asks about the primary one and the distractors stay clearly wrong.
 *
 * No culture-specific idioms or region-specific spellings beyond standard British English, which is what
 * the rest of the app uses.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Beginner: everyday words, plain synonyms and opposites. */
export const VOCABULARY_BEGINNER: SeedQuestion[] = [
  { id: 'vb01', text: 'What does “enormous” mean?', options: ['Very small', 'Very large', 'Very fast', 'Very old'], correctIndex: 1 },
  { id: 'vb02', text: 'Which word means the opposite of “ancient”?', options: ['Antique', 'Historic', 'Modern', 'Aged'], correctIndex: 2 },
  { id: 'vb03', text: 'Which word means almost the same as “happy”?', options: ['Cheerful', 'Gloomy', 'Angry', 'Weary'], correctIndex: 0 },
  { id: 'vb04', text: 'What does “brave” mean?', options: ['Feeling afraid', 'Showing courage', 'Being clever', 'Being polite'], correctIndex: 1 },
  { id: 'vb05', text: 'Which word means the opposite of “difficult”?', options: ['Tricky', 'Complicated', 'Easy', 'Heavy'], correctIndex: 2 },
  { id: 'vb06', text: 'What does “rapid” mean?', options: ['Very slow', 'Very quiet', 'Very fast', 'Very heavy'], correctIndex: 2 },
  { id: 'vb07', text: 'Which word means almost the same as “begin”?', options: ['Finish', 'Start', 'Pause', 'Repeat'], correctIndex: 1 },
  { id: 'vb08', text: 'What does “silent” mean?', options: ['Making no sound', 'Moving quickly', 'Feeling sad', 'Shining brightly'], correctIndex: 0 },
  { id: 'vb09', text: 'Which word means the opposite of “generous”?', options: ['Kind', 'Selfish', 'Wealthy', 'Careful'], correctIndex: 1 },
  { id: 'vb10', text: 'If food is “delicious”, it:', options: ['Looks colourful', 'Is very hot', 'Tastes very good', 'Is very cheap'], correctIndex: 2 },
  { id: 'vb11', text: 'What does “weary” mean?', options: ['Very tired', 'Very hungry', 'Very pleased', 'Very rich'], correctIndex: 0 },
  { id: 'vb12', text: 'What does “gentle” mean?', options: ['Rough and hard', 'Soft and careful', 'Loud and busy', 'Cold and wet'], correctIndex: 1 },
  { id: 'vb13', text: 'Which word means the opposite of “arrive”?', options: ['Enter', 'Travel', 'Leave', 'Wait'], correctIndex: 2 },
  { id: 'vb14', text: 'Which word means almost the same as “shout”?', options: ['Whisper', 'Yell', 'Mumble', 'Sigh'], correctIndex: 1 },
  { id: 'vb15', text: 'What is a “vehicle”?', options: ['Something you ride or drive in', 'A kind of food', 'A type of building', 'A piece of clothing'], correctIndex: 0 },
  { id: 'vb16', text: 'Which word means the opposite of “empty”?', options: ['Hollow', 'Open', 'Light', 'Full'], correctIndex: 3 },
  { id: 'vb17', text: 'What does “damp” mean?', options: ['Completely dry', 'Slightly wet', 'Very hot', 'Very cold'], correctIndex: 1 },
  { id: 'vb18', text: 'Which word means almost the same as “quick”?', options: ['Swift', 'Steady', 'Gentle', 'Heavy'], correctIndex: 0 },
  { id: 'vb19', text: 'What does “polite” mean?', options: ['Being very loud', 'Being very fast', 'Having good manners', 'Being very strong'], correctIndex: 2 },
  { id: 'vb20', text: 'What does “ordinary” mean?', options: ['Very unusual', 'Completely normal', 'Extremely rare', 'Slightly broken'], correctIndex: 1 },
];

/** Intermediate: prefixes and suffixes, and words a child meets in reading rather than in speech. */
export const VOCABULARY_INTERMEDIATE: SeedQuestion[] = [
  { id: 'vi01', text: 'What does the prefix “un-” usually mean?', options: ['Again', 'Not', 'Before', 'Under'], correctIndex: 1 },
  { id: 'vi02', text: 'What does “reluctant” mean?', options: ['Eager to help', 'Unwilling to do something', 'Extremely tired', 'Very confident'], correctIndex: 1 },
  { id: 'vi03', text: 'Which word means the opposite of “abundant”?', options: ['Plentiful', 'Scarce', 'Generous', 'Frequent'], correctIndex: 1 },
  { id: 'vi04', text: 'What does the prefix “pre-” mean?', options: ['After', 'Against', 'Before', 'Around'], correctIndex: 2 },
  { id: 'vi05', text: 'What does “fragile” mean?', options: ['Easily broken', 'Very heavy', 'Brightly coloured', 'Extremely useful'], correctIndex: 0 },
  { id: 'vi06', text: 'Which word means almost the same as “furious”?', options: ['Confused', 'Enraged', 'Delighted', 'Nervous'], correctIndex: 1 },
  { id: 'vi07', text: 'What does “hesitate” mean?', options: ['To pause before acting', 'To run very fast', 'To speak loudly', 'To finish early'], correctIndex: 0 },
  { id: 'vi08', text: 'What does the suffix “-less” mean?', options: ['Full of', 'Able to', 'Without', 'Belonging to'], correctIndex: 2 },
  { id: 'vi09', text: 'What does “vivid” mean?', options: ['Very dull', 'Bright and clear', 'Very quiet', 'Rather slow'], correctIndex: 1 },
  { id: 'vi10', text: 'Which word means the opposite of “ascend”?', options: ['Climb', 'Descend', 'Rise', 'Hover'], correctIndex: 1 },
  { id: 'vi11', text: 'What does “sincere” mean?', options: ['Honest and genuine', 'Funny and clever', 'Loud and rude', 'Quiet and shy'], correctIndex: 0 },
  { id: 'vi12', text: 'What does “essential” mean?', options: ['Slightly useful', 'Absolutely necessary', 'Rarely needed', 'Completely optional'], correctIndex: 1 },
  { id: 'vi13', text: 'What does the prefix “mis-” suggest?', options: ['Wrongly', 'Very', 'Again', 'Together'], correctIndex: 0 },
  { id: 'vi14', text: 'What does “peculiar” mean?', options: ['Perfectly normal', 'Strange or odd', 'Extremely large', 'Very expensive'], correctIndex: 1 },
  { id: 'vi15', text: 'What does “consequence” mean?', options: ['A result of an action', 'A kind of question', 'A type of journey', 'A short rest'], correctIndex: 0 },
  { id: 'vi16', text: 'Which word means the opposite of “temporary”?', options: ['Brief', 'Sudden', 'Permanent', 'Occasional'], correctIndex: 2 },
  { id: 'vi17', text: 'What does “observe” mean?', options: ['To watch carefully', 'To speak quickly', 'To forget entirely', 'To build something'], correctIndex: 0 },
  { id: 'vi18', text: 'What does the ending “-ology” mean?', options: ['The fear of', 'The study of', 'The love of', 'The making of'], correctIndex: 1 },
  { id: 'vi19', text: 'What does “cautious” mean?', options: ['Careful to avoid danger', 'Willing to take risks', 'Extremely fast', 'Rather forgetful'], correctIndex: 0 },
  { id: 'vi20', text: 'Which word means almost the same as “sufficient”?', options: ['Excessive', 'Lacking', 'Enough', 'Rare'], correctIndex: 2 },
];

/** Hard: precise words, Latin and Greek roots, and pairs that are easy to confuse. */
export const VOCABULARY_HARD: SeedQuestion[] = [
  { id: 'vh01', text: 'What does “ubiquitous” mean?', options: ['Found everywhere', 'Extremely rare', 'Highly poisonous', 'Very ancient'], correctIndex: 0 },
  { id: 'vh02', text: 'What does “ambiguous” mean?', options: ['Perfectly clear', 'Having more than one meaning', 'Extremely loud', 'Very expensive'], correctIndex: 1 },
  { id: 'vh03', text: 'Which word means the opposite of “benevolent”?', options: ['Kind', 'Malevolent', 'Generous', 'Cheerful'], correctIndex: 1 },
  { id: 'vh04', text: 'What does “meticulous” mean?', options: ['Rather careless', 'Extremely careful about detail', 'Deeply unhappy', 'Very forgetful'], correctIndex: 1 },
  { id: 'vh05', text: 'The root “bene” means:', options: ['Good', 'Bad', 'Life', 'Time'], correctIndex: 0 },
  { id: 'vh06', text: 'What does “candid” mean?', options: ['Secretive', 'Honest and direct', 'Easily confused', 'Wildly enthusiastic'], correctIndex: 1 },
  { id: 'vh07', text: 'Which word means almost the same as “resilient”?', options: ['Fragile', 'Poorly made', 'Able to recover quickly', 'Extremely slow'], correctIndex: 2 },
  { id: 'vh08', text: 'What does “obsolete” mean?', options: ['No longer used', 'Newly invented', 'Very expensive', 'Highly secret'], correctIndex: 0 },
  { id: 'vh09', text: 'What does “pragmatic” mean?', options: ['Acting on emotion', 'Dealing with things practically', 'Refusing to decide', 'Following tradition'], correctIndex: 1 },
  { id: 'vh10', text: 'What does the prefix “anti-” mean?', options: ['Beyond', 'Among', 'Against', 'Before'], correctIndex: 2 },
  { id: 'vh11', text: 'What does “conspicuous” mean?', options: ['Easily noticed', 'Well hidden', 'Extremely quiet', 'Rarely used'], correctIndex: 0 },
  { id: 'vh12', text: 'Which word means the opposite of “verbose”?', options: ['Wordy', 'Concise', 'Talkative', 'Detailed'], correctIndex: 1 },
  { id: 'vh13', text: 'What does “tenacious” mean?', options: ['Giving up easily', 'Moving very fast', 'Holding on firmly', 'Feeling nervous'], correctIndex: 2 },
  { id: 'vh14', text: 'What does “inevitable” mean?', options: ['Certain to happen', 'Easily avoided', 'Highly unlikely', 'Recently changed'], correctIndex: 0 },
  { id: 'vh15', text: 'The root “chrono” refers to:', options: ['Water', 'Time', 'Light', 'Sound'], correctIndex: 1 },
  { id: 'vh16', text: 'What does “scrutinise” mean?', options: ['To examine closely', 'To ignore completely', 'To destroy quickly', 'To copy exactly'], correctIndex: 0 },
  { id: 'vh17', text: 'What does “arduous” mean?', options: ['Extremely easy', 'Very enjoyable', 'Rather dull', 'Requiring great effort'], correctIndex: 3 },
  { id: 'vh18', text: 'Which word means almost the same as “diligent”?', options: ['Hard-working', 'Careless', 'Forgetful', 'Impatient'], correctIndex: 0 },
  { id: 'vh19', text: 'What does “eloquent” mean?', options: ['Speaking very quietly', 'Speaking fluently and persuasively', 'Refusing to speak', 'Speaking a foreign language'], correctIndex: 1 },
  { id: 'vh20', text: 'What does “superfluous” mean?', options: ['Absolutely essential', 'More than is needed', 'Extremely rare', 'Very powerful'], correctIndex: 1 },
];

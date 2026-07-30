/**
 * Grammar question banks.
 *
 * Same shape and authoring rules as `maths.ts`. Two things specific to this category:
 *
 *  - **British English throughout**, matching the rest of the app. No question turns on a
 *    British/American spelling difference, because that punishes a child for their variety of English
 *    rather than testing grammar.
 *  - **No contested usage.** Split infinitives, singular "they", and the Oxford comma are all defensible
 *    either way, so none of them appear. Every question has an answer that no reasonable teacher would
 *    mark wrong.
 *
 * Distractors are the errors children actually make — its/it's, their/there/they're, your/you're,
 * fewer/less, subject-verb agreement across a long subject — rather than nonsense options.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Beginner: parts of speech, sentence basics, and the most common punctuation. */
export const GRAMMAR_BEGINNER: SeedQuestion[] = [
  { id: 'rb01', text: 'Which word in this sentence is a noun? “The dog barked loudly.”', options: ['The', 'Dog', 'Barked', 'Loudly'], correctIndex: 1 },
  { id: 'rb02', text: 'Which word is a verb? “She quickly opened the door.”', options: ['She', 'Quickly', 'Opened', 'Door'], correctIndex: 2 },
  { id: 'rb03', text: 'What punctuation mark ends a question?', options: ['A full stop', 'A question mark', 'A comma', 'An exclamation mark'], correctIndex: 1 },
  { id: 'rb04', text: 'Which sentence is written correctly?', options: ['we went to the park.', 'We went to the park.', 'We Went To The Park.', 'we Went to the park'], correctIndex: 1 },
  { id: 'rb05', text: 'Which word is an adjective? “The tall boy ran home.”', options: ['The', 'Tall', 'Ran', 'Home'], correctIndex: 1 },
  { id: 'rb06', text: 'What is the plural of “child”?', options: ['Childs', 'Childes', 'Children', 'Childrens'], correctIndex: 2 },
  { id: 'rb07', text: 'Which word completes this correctly? “She ___ to school every day.”', options: ['walk', 'walks', 'walking', 'walked to'], correctIndex: 1 },
  { id: 'rb08', text: 'What is the plural of “mouse”?', options: ['Mouses', 'Mice', 'Mices', 'Mouse'], correctIndex: 1 },
  { id: 'rb09', text: 'Which word is a pronoun?', options: ['Table', 'She', 'Quickly', 'Green'], correctIndex: 1 },
  { id: 'rb10', text: 'Which sentence uses a capital letter correctly?', options: ['my name is amina.', 'My name is Amina.', 'my Name is Amina.', 'MY name is amina.'], correctIndex: 1 },
  { id: 'rb11', text: 'What is the past tense of “go”?', options: ['Goed', 'Gone', 'Went', 'Going'], correctIndex: 2 },
  { id: 'rb12', text: 'Which word is an adverb? “He spoke softly.”', options: ['He', 'Spoke', 'Softly', 'None of them'], correctIndex: 2 },
  { id: 'rb13', text: 'Which of these is a complete sentence?', options: ['Running down the road.', 'The blue one.', 'Birds fly.', 'When it rained.'], correctIndex: 2 },
  { id: 'rb14', text: 'What is the plural of “box”?', options: ['Boxs', 'Boxes', 'Boxen', 'Box'], correctIndex: 1 },
  { id: 'rb15', text: 'Which word joins these? “I was tired ___ I kept going.”', options: ['but', 'so', 'because', 'or'], correctIndex: 0 },
  { id: 'rb16', text: 'What is the past tense of “eat”?', options: ['Eated', 'Ate', 'Eaten', 'Eating'], correctIndex: 1 },
  { id: 'rb17', text: 'Which sentence is a question?', options: ['She is at home.', 'Close the door.', 'Where is my bag?', 'What a day!'], correctIndex: 2 },
  { id: 'rb18', text: 'Which word is a preposition? “The cat sat under the chair.”', options: ['Cat', 'Sat', 'Under', 'Chair'], correctIndex: 2 },
  { id: 'rb19', text: 'What is the plural of “leaf”?', options: ['Leafs', 'Leaves', 'Leafes', 'Leave'], correctIndex: 1 },
  { id: 'rb20', text: 'Which sentence uses a comma correctly?', options: ['I bought apples bananas and pears.', 'I bought apples, bananas and pears.', 'I, bought apples bananas and pears.', 'I bought, apples bananas, and pears.'], correctIndex: 1 },
];

/** Intermediate: the homophone traps, agreement, tenses and apostrophes. */
export const GRAMMAR_INTERMEDIATE: SeedQuestion[] = [
  // The single most common written error in English.
  { id: 'ri01', text: 'Which is correct? “The dog wagged ___ tail.”', options: ['it’s', 'its', 'its’', 'it is'], correctIndex: 1 },
  { id: 'ri02', text: 'Which is correct? “___ going to be late.”', options: ['Their', 'There', 'They’re', 'Theyre'], correctIndex: 2 },
  { id: 'ri03', text: 'Which is correct? “___ book is this?”', options: ['Whose', 'Who’s', 'Whos', 'Who is'], correctIndex: 0 },
  { id: 'ri04', text: 'Which sentence uses the verb correctly?', options: ['She don’t like it.', 'She doesn’t likes it.', 'She doesn’t like it.', 'She not like it.'], correctIndex: 2 },
  { id: 'ri05', text: 'Which is correct? “There are ___ chairs than people.”', options: ['less', 'fewer', 'lesser', 'least'], correctIndex: 1 },
  { id: 'ri06', text: 'Where does the apostrophe go in the plural possessive “the bags of the girls”?', options: ['the girl’s bags', 'the girls’ bags', 'the girls bag’s', 'the girls’s bags'], correctIndex: 1 },
  { id: 'ri07', text: 'Which is correct? “___ coming to the party?”', options: ['Your', 'You’re', 'Youre', 'Yours'], correctIndex: 1 },
  { id: 'ri08', text: 'Which sentence is in the past perfect tense?', options: ['I ate lunch.', 'I had eaten lunch.', 'I am eating lunch.', 'I will eat lunch.'], correctIndex: 1 },
  { id: 'ri09', text: 'Which is correct? “Each of the students ___ a book.”', options: ['have', 'has', 'are having', 'were having'], correctIndex: 1 },
  { id: 'ri10', text: 'What is the comparative form of “good”?', options: ['Gooder', 'More good', 'Better', 'Best'], correctIndex: 2 },
  { id: 'ri11', text: 'Which sentence uses “effect” correctly?', options: ['The rain will effect the match.', 'The rain had a big effect on the match.', 'Please effect the change quickly.', 'It effected me deeply.'], correctIndex: 1 },
  { id: 'ri12', text: 'Which is correct? “She is taller ___ her brother.”', options: ['then', 'than', 'that', 'as'], correctIndex: 1 },
  { id: 'ri13', text: 'Which sentence is in the passive voice?', options: ['The cat chased the mouse.', 'The mouse was chased by the cat.', 'The cat is chasing the mouse.', 'Chase the mouse!'], correctIndex: 1 },
  { id: 'ri14', text: 'Which is correct? “The team ___ playing well this season.”', options: ['is', 'are being', 'were', 'be'], correctIndex: 0 },
  { id: 'ri15', text: 'What is the superlative form of “bad”?', options: ['Badder', 'Baddest', 'Worse', 'Worst'], correctIndex: 3 },
  { id: 'ri16', text: 'Which sentence uses a semicolon correctly?', options: ['I was tired; so I slept.', 'I was tired; I went to bed early.', 'I was tired; and hungry.', 'I was; tired and hungry.'], correctIndex: 1 },
  { id: 'ri17', text: 'Which is correct? “He ___ finished his homework yet.”', options: ['has not', 'have not', 'had not have', 'not has'], correctIndex: 0 },
  { id: 'ri18', text: 'Which word is a conjunction?', options: ['Quickly', 'Although', 'Beautiful', 'Under'], correctIndex: 1 },
  { id: 'ri19', text: 'Which sentence uses the pronouns correctly?', options: ['Me and him went out.', 'He and I went out.', 'Him and me went out.', 'I and him went out.'], correctIndex: 1 },
  { id: 'ri20', text: 'What does an apostrophe in “can’t” replace?', options: ['The letters “no”', 'The letter “o”', 'The letters “an”', 'Nothing at all'], correctIndex: 1 },
];

/** Hard: clause structure, mood, and the constructions that trip up adults. */
export const GRAMMAR_HARD: SeedQuestion[] = [
  { id: 'rh01', text: 'What is the subject of this sentence? “Behind the old wall stood a tree.”', options: ['Behind', 'The old wall', 'A tree', 'Stood'], correctIndex: 2 },
  { id: 'rh02', text: 'Which sentence contains a subordinate clause?', options: ['I ran and I jumped.', 'Although it rained, we played.', 'She sang beautifully.', 'Open the window.'], correctIndex: 1 },
  { id: 'rh03', text: 'Which sentence uses the subjunctive correctly?', options: ['If I was you, I would go.', 'If I were you, I would go.', 'If I am you, I would go.', 'If I be you, I would go.'], correctIndex: 1 },
  { id: 'rh04', text: 'What is a dangling modifier?', options: ['A describing phrase with nothing sensible to describe', 'A very long sentence', 'A missing full stop', 'A repeated adjective'], correctIndex: 0 },
  { id: 'rh05', text: 'With “neither … nor”, which sentence agrees correctly?', options: ['Neither the boys nor the girl were ready.', 'Neither the boys nor the girl was ready.', 'Neither the boys nor the girl is ready.', 'Neither the boys or the girl was ready.'], correctIndex: 1 },
  { id: 'rh06', text: 'What kind of word is “running” in “Running is good exercise”?', options: ['A verb', 'A gerund acting as a noun', 'An adjective', 'An adverb'], correctIndex: 1 },
  { id: 'rh07', text: 'Which sentence uses a colon correctly?', options: ['I need: milk, eggs and bread.', 'I need the following: milk, eggs and bread.', 'I: need milk, eggs and bread.', 'I need milk: eggs and bread.'], correctIndex: 1 },
  { id: 'rh08', text: 'What is the direct object in “She gave him the letter”?', options: ['She', 'Him', 'The letter', 'Gave'], correctIndex: 2 },
  { id: 'rh09', text: 'Which sentence is a comma splice?', options: ['It was late, so we left.', 'It was late; we left.', 'It was late, we left.', 'Because it was late, we left.'], correctIndex: 2 },
  { id: 'rh10', text: 'Which is the correct relative pronoun? “The woman ___ won the race is my aunt.”', options: ['which', 'who', 'whom', 'whose'], correctIndex: 1 },
  { id: 'rh11', text: 'What is the past participle of “write”?', options: ['Wrote', 'Written', 'Writed', 'Writing'], correctIndex: 1 },
  { id: 'rh12', text: 'Which sentence uses “whom” correctly?', options: ['Whom is at the door?', 'To whom did you give it?', 'Whom went to the shop?', 'Whom are you?'], correctIndex: 1 },
  { id: 'rh13', text: 'What is an interjection?', options: ['A word expressing sudden feeling', 'A word joining two clauses', 'A word describing a noun', 'A word showing position'], correctIndex: 0 },
  { id: 'rh14', text: 'Which sentence is in the future perfect tense?', options: ['I will finish by noon.', 'I will have finished by noon.', 'I am finishing at noon.', 'I finished at noon.'], correctIndex: 1 },
  { id: 'rh15', text: 'Which sentence agrees correctly with “the number of …”?', options: ['The number of pupils are rising.', 'The number of pupils is rising.', 'The number of pupils were rising.', 'The number of pupils have risen.'], correctIndex: 1 },
  { id: 'rh16', text: 'What does a relative clause do?', options: ['Gives more information about a noun', 'Replaces the main verb', 'Ends the sentence', 'Joins two full sentences'], correctIndex: 0 },
  { id: 'rh17', text: 'Which sentence uses parentheses correctly?', options: ['My brother (who lives in Accra) is visiting.', 'My brother who lives in (Accra) is visiting.', 'My (brother who lives in Accra) is visiting.', 'My brother who (lives) in Accra is visiting.'], correctIndex: 0 },
  { id: 'rh18', text: 'What is the indirect object in “She gave him the letter”?', options: ['She', 'Him', 'The letter', 'There is none'], correctIndex: 1 },
  { id: 'rh19', text: 'Which sentence avoids a dangling modifier?', options: ['Having eaten, the plates were cleared.', 'Having eaten, we cleared the plates.', 'Having ate, we cleared the plates.', 'Having eaten the plates, were cleared.'], correctIndex: 1 },
  { id: 'rh20', text: 'What is the difference between “lie” and “lay”?', options: ['They mean exactly the same', '“Lay” needs an object; “lie” does not', '“Lie” needs an object; “lay” does not', '“Lay” is only ever past tense'], correctIndex: 1 },
];

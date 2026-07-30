/**
 * Science question banks.
 *
 * Same shape as `maths.ts`: all three levels in one file so the cross-level duplicate checks can see
 * them. That layout exists because splitting maths across two files hid four duplicates.
 *
 * Authoring rules are documented in `maths.ts` and applied here too — one defensible answer, distractors
 * that each represent a specific likely misconception, varied answer positions, no locale-specific units.
 *
 * **Facts were chosen to be stable.** Anything that changes with new discoveries or political events is
 * avoided on purpose: no "how many moons does Saturn have" (the count keeps rising), no "newest element",
 * no record-holders likely to be broken. A children's app that quietly goes wrong as the world changes is
 * worse than one that asks slightly duller questions.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/**
 * Beginner — the original "Science Quiz" bank, moved here verbatim.
 *
 * It was assigned to INTERMEDIATE by the redesign migration, which derived the level from the old
 * `difficulty` column. Reading it makes clear that was wrong: "how many legs does an insect have", "what
 * do bees collect", "which planet is the Red Planet" are beginner material. The migration now places it
 * at beginner, and the two levels above are authored fresh.
 *
 * Preserved exactly — same ids, same text — because these rows are live: children have played them and
 * `GameQuestionSeen` references their ids.
 */
export const SCIENCE_BEGINNER: SeedQuestion[] = [
  { id: 's01', text: 'What gas do plants absorb during photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], correctIndex: 2 },
  { id: 's02', text: 'How many bones are in the adult human body?', options: ['196', '206', '216', '226'], correctIndex: 1 },
  { id: 's03', text: 'What is the closest planet to the Sun?', options: ['Venus', 'Mars', 'Mercury', 'Earth'], correctIndex: 2 },
  { id: 's04', text: 'What is the speed of light (approx)?', options: ['300,000 km/s', '150,000 km/s', '450,000 km/s', '100,000 km/s'], correctIndex: 0 },
  { id: 's05', text: 'Which organ pumps blood around the body?', options: ['Lungs', 'Brain', 'Liver', 'Heart'], correctIndex: 3 },
  { id: 's06', text: 'What is the chemical symbol for water?', options: ['H2O', 'CO2', 'O2', 'NaCl'], correctIndex: 0 },
  { id: 's07', text: 'How many planets are in our solar system?', options: ['7', '8', '9', '10'], correctIndex: 1 },
  { id: 's08', text: 'What force pulls objects towards the Earth?', options: ['Magnetism', 'Friction', 'Gravity', 'Pressure'], correctIndex: 2 },
  { id: 's09', text: 'Which part of the plant makes food?', options: ['Root', 'Stem', 'Leaf', 'Flower'], correctIndex: 2 },
  { id: 's10', text: 'What do we call animals that eat only plants?', options: ['Carnivores', 'Herbivores', 'Omnivores', 'Insectivores'], correctIndex: 1 },
  { id: 's11', text: 'At what temperature does water freeze (Celsius)?', options: ['0°C', '10°C', '32°C', '100°C'], correctIndex: 0 },
  { id: 's12', text: 'What is the largest planet in our solar system?', options: ['Saturn', 'Neptune', 'Jupiter', 'Earth'], correctIndex: 2 },
  { id: 's13', text: 'Which gas do humans need to breathe?', options: ['Nitrogen', 'Oxygen', 'Helium', 'Carbon Dioxide'], correctIndex: 1 },
  { id: 's14', text: 'What is the hardest natural substance?', options: ['Iron', 'Gold', 'Diamond', 'Quartz'], correctIndex: 2 },
  { id: 's15', text: 'How many legs does an insect have?', options: ['4', '6', '8', '10'], correctIndex: 1 },
  { id: 's16', text: 'What do bees collect from flowers?', options: ['Sap', 'Nectar', 'Pollen only', 'Water'], correctIndex: 1 },
  { id: 's17', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Mercury', 'Jupiter'], correctIndex: 1 },
  { id: 's18', text: 'What is the centre of an atom called?', options: ['Electron', 'Nucleus', 'Proton', 'Shell'], correctIndex: 1 },
  { id: 's19', text: 'What kind of animal is a frog?', options: ['Reptile', 'Amphibian', 'Mammal', 'Fish'], correctIndex: 1 },
  { id: 's20', text: 'What does a caterpillar turn into?', options: ['Beetle', 'Butterfly', 'Bee', 'Dragonfly'], correctIndex: 1 },
  { id: 's21', text: 'Which body part controls your movements?', options: ['Heart', 'Brain', 'Stomach', 'Lungs'], correctIndex: 1 },
  { id: 's22', text: 'What is the boiling point of water (Celsius)?', options: ['50°C', '90°C', '100°C', '150°C'], correctIndex: 2 },
  { id: 's23', text: 'What are clouds mostly made of?', options: ['Smoke', 'Water droplets', 'Dust', 'Air'], correctIndex: 1 },
  { id: 's24', text: 'Which animal is the largest on Earth?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Great white shark'], correctIndex: 1 },
  { id: 's25', text: 'What do we call the path a planet takes around the Sun?', options: ['Rotation', 'Orbit', 'Axis', 'Spin'], correctIndex: 1 },
];

/**
 * Intermediate: states of matter, the periodic table's common symbols, body systems, forces, energy and
 * simple chemistry. Roughly lower to mid secondary.
 */
export const SCIENCE_INTERMEDIATE: SeedQuestion[] = [
  { id: 'si01', text: 'What is the chemical symbol for gold?', options: ['Au', 'Go', 'Gd', 'Ag'], correctIndex: 0 },
  // Ag is silver — the distractor that catches a half-remembered periodic table.
  { id: 'si02', text: 'Which blood cells fight infection?', options: ['Red blood cells', 'White blood cells', 'Platelets', 'Plasma'], correctIndex: 1 },
  { id: 'si03', text: 'What is the process called when a liquid turns into a gas?', options: ['Condensation', 'Evaporation', 'Freezing', 'Melting'], correctIndex: 1 },
  { id: 'si04', text: 'How many chambers does the human heart have?', options: ['Two', 'Three', 'Four', 'Six'], correctIndex: 2 },
  { id: 'si05', text: 'What type of energy is stored in food?', options: ['Kinetic energy', 'Chemical energy', 'Thermal energy', 'Sound energy'], correctIndex: 1 },
  // Most people answer oxygen; nitrogen is about 78% and oxygen only about 21%.
  { id: 'si06', text: 'Which gas makes up about 78% of the air around us?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], correctIndex: 2 },
  { id: 'si07', text: 'Which part of a cell releases most of its energy?', options: ['The nucleus', 'The mitochondria', 'The cell wall', 'The membrane'], correctIndex: 1 },
  { id: 'si08', text: 'What do we call an animal that eats both plants and meat?', options: ['A herbivore', 'A carnivore', 'A decomposer', 'An omnivore'], correctIndex: 3 },
  { id: 'si09', text: 'Which gas is the Sun mostly made of?', options: ['Helium', 'Hydrogen', 'Oxygen', 'Nitrogen'], correctIndex: 1 },
  { id: 'si10', text: 'A ramp is an example of which simple machine?', options: ['A lever', 'A pulley', 'An inclined plane', 'A wheel and axle'], correctIndex: 2 },
  { id: 'si11', text: 'Which part of a plant carries water up from the roots?', options: ['The phloem', 'The xylem', 'The stomata', 'The petals'], correctIndex: 1 },
  { id: 'si12', text: 'What usually happens to a metal bar when it is heated?', options: ['It contracts', 'It expands', 'It freezes', 'It dissolves'], correctIndex: 1 },
  { id: 'si13', text: 'What do we call animals that have a backbone?', options: ['Invertebrates', 'Arthropods', 'Vertebrates', 'Molluscs'], correctIndex: 2 },
  { id: 'si14', text: 'Which organ filters waste out of the blood?', options: ['The liver', 'The lungs', 'The kidneys', 'The stomach'], correctIndex: 2 },
  { id: 'si15', text: 'What is the chemical formula for carbon dioxide?', options: ['CO', 'CO₂', 'C₂O', 'CaO'], correctIndex: 1 },
  // Burning is irreversible and makes new substances — the definition of a chemical change.
  { id: 'si16', text: 'Burning a piece of paper is an example of what?', options: ['A physical change', 'A chemical change', 'A change of state', 'No change at all'], correctIndex: 1 },
  { id: 'si17', text: 'Which force slows down an object sliding across a surface?', options: ['Gravity', 'Magnetism', 'Friction', 'Upthrust'], correctIndex: 2 },
  { id: 'si18', text: 'What is the pH of a neutral substance such as pure water?', options: ['0', '7', '10', '14'], correctIndex: 1 },
  { id: 'si19', text: 'What do we call the change from a gas back into a liquid?', options: ['Evaporation', 'Sublimation', 'Melting', 'Condensation'], correctIndex: 3 },
  { id: 'si20', text: 'Which part of the eye controls how much light gets in?', options: ['The retina', 'The iris', 'The cornea', 'The lens'], correctIndex: 1 },
];

/**
 * Hard: atomic structure, genetics, physics relationships and named laws. Roughly mid to upper secondary.
 */
export const SCIENCE_HARD: SeedQuestion[] = [
  { id: 'sh01', text: 'What is the atomic number of carbon?', options: ['4', '6', '12', '14'], correctIndex: 1 },
  // 12 is carbon's mass number — the most common confusion in the whole topic.
  { id: 'sh02', text: 'Which subatomic particle carries a negative charge?', options: ['The proton', 'The neutron', 'The electron', 'The nucleus'], correctIndex: 2 },
  { id: 'sh03', text: 'What is the chemical symbol for potassium?', options: ['P', 'Po', 'Pt', 'K'], correctIndex: 3 },
  { id: 'sh04', text: 'What does DNA stand for?', options: ['Deoxyribonucleic acid', 'Dinucleic acid', 'Deoxyribose nitrate', 'Double nucleic acid'], correctIndex: 0 },
  { id: 'sh05', text: 'What is the SI unit of force?', options: ['The joule', 'The newton', 'The watt', 'The pascal'], correctIndex: 1 },
  { id: 'sh06', text: 'Which type of chemical bond involves atoms SHARING electrons?', options: ['Ionic', 'Covalent', 'Metallic', 'Hydrogen'], correctIndex: 1 },
  { id: 'sh07', text: 'How do you calculate speed?', options: ['Distance × time', 'Distance ÷ time', 'Time ÷ distance', 'Mass × distance'], correctIndex: 1 },
  { id: 'sh08', text: 'How many chromosomes are in a normal human body cell?', options: ['23', '44', '46', '48'], correctIndex: 2 },
  // 23 is the number in a sex cell, and the usual wrong answer.
  { id: 'sh09', text: 'What makes two atoms isotopes of each other?', options: ['Different numbers of protons', 'Different numbers of neutrons', 'Different numbers of electrons', 'Different charges'], correctIndex: 1 },
  { id: 'sh10', text: 'Which part of the brain controls balance and coordination?', options: ['The cerebrum', 'The cerebellum', 'The hippocampus', 'The medulla'], correctIndex: 1 },
  { id: 'sh11', text: 'A solution with a pH of 2 is:', options: ['Strongly acidic', 'Slightly acidic', 'Neutral', 'Strongly alkaline'], correctIndex: 0 },
  { id: 'sh12', text: 'Which gas is usually produced when an acid reacts with a metal?', options: ['Oxygen', 'Hydrogen', 'Carbon dioxide', 'Nitrogen'], correctIndex: 1 },
  { id: 'sh13', text: 'What does the law of conservation of energy state?', options: ['Energy always increases', 'Energy cannot be created or destroyed', 'Energy is always lost as heat', 'Energy can be made from nothing'], correctIndex: 1 },
  { id: 'sh14', text: 'What is the name of the cell division that makes two identical cells?', options: ['Meiosis', 'Mitosis', 'Osmosis', 'Diffusion'], correctIndex: 1 },
  { id: 'sh15', text: 'Which element has the chemical symbol Fe?', options: ['Fluorine', 'Francium', 'Iron', 'Fermium'], correctIndex: 2 },
  { id: 'sh16', text: 'What is the SI unit of frequency?', options: ['The hertz', 'The decibel', 'The watt', 'The volt'], correctIndex: 0 },
  { id: 'sh17', text: 'What does Newton’s third law say?', options: ['Force equals mass times acceleration', 'Every action has an equal and opposite reaction', 'An object stays still unless pushed', 'Energy cannot be destroyed'], correctIndex: 1 },
  { id: 'sh18', text: 'What is terminal velocity?', options: ['The fastest an object can ever travel', 'The speed of light', 'The steady speed reached when drag balances weight', 'The speed at which an object breaks apart'], correctIndex: 2 },
  { id: 'sh19', text: 'Which process joins light nuclei together to release energy in stars?', options: ['Nuclear fission', 'Nuclear fusion', 'Combustion', 'Oxidation'], correctIndex: 1 },
  { id: 'sh20', text: 'What is the function of haemoglobin in the blood?', options: ['To fight infection', 'To carry oxygen', 'To clot wounds', 'To digest food'], correctIndex: 1 },
];

/**
 * Geography question banks.
 *
 * Same shape and authoring rules as `maths.ts` and `science.ts`.
 *
 * **Deliberately avoided:** anything that shifts with politics or record-keeping — renamed capitals,
 * "most time zones" (contested), "never colonised" (contested), populations and rankings that change.
 * A children's app that quietly becomes wrong is worse than one that asks steadier questions. Capitals
 * used here are long-stable ones.
 */

export interface SeedQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/**
 * Beginner — the original "World Geography" bank, moved here verbatim.
 *
 * The redesign migration assigned it to HARD because its old `difficulty` column said hard. Reading it
 * shows otherwise: continent counts, "which country is shaped like a boot", and the capitals of France,
 * Japan and Egypt are beginner material. The migration now places it at beginner and the two levels above
 * are authored fresh.
 *
 * Preserved exactly — same ids, same text — because these rows are live and `GameQuestionSeen` references
 * their ids.
 */
export const GEOGRAPHY_BEGINNER: SeedQuestion[] = [
  { id: 'g01', text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], correctIndex: 2 },
  { id: 'g02', text: 'Which is the largest country by land area?', options: ['China', 'Canada', 'USA', 'Russia'], correctIndex: 3 },
  { id: 'g03', text: 'What is the capital of Brazil?', options: ['Rio de Janeiro', 'São Paulo', 'Brasília', 'Salvador'], correctIndex: 2 },
  { id: 'g04', text: 'On which continent is Ghana located?', options: ['Asia', 'South America', 'Africa', 'Europe'], correctIndex: 2 },
  { id: 'g05', text: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correctIndex: 1 },
  { id: 'g06', text: 'What is the capital of Japan?', options: ['Osaka', 'Kyoto', 'Tokyo', 'Nagoya'], correctIndex: 2 },
  { id: 'g07', text: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
  { id: 'g08', text: 'What is the capital of Canada?', options: ['Toronto', 'Ottawa', 'Vancouver', 'Montreal'], correctIndex: 1 },
  { id: 'g09', text: 'Which country has the most people?', options: ['China', 'India', 'USA', 'Indonesia'], correctIndex: 1 },
  { id: 'g10', text: 'What is the tallest mountain in the world?', options: ['K2', 'Everest', 'Kilimanjaro', 'Denali'], correctIndex: 1 },
  { id: 'g11', text: 'What is the capital of France?', options: ['Lyon', 'Marseille', 'Paris', 'Nice'], correctIndex: 2 },
  { id: 'g12', text: 'Which desert is the largest hot desert?', options: ['Gobi', 'Kalahari', 'Sahara', 'Arabian'], correctIndex: 2 },
  { id: 'g13', text: 'How many continents are there?', options: ['5', '6', '7', '8'], correctIndex: 2 },
  { id: 'g14', text: 'What is the capital of Egypt?', options: ['Alexandria', 'Cairo', 'Giza', 'Luxor'], correctIndex: 1 },
  { id: 'g15', text: 'Which country is shaped like a boot?', options: ['Spain', 'Greece', 'Italy', 'Portugal'], correctIndex: 2 },
  { id: 'g16', text: 'What is the smallest country in the world?', options: ['Monaco', 'Vatican City', 'San Marino', 'Malta'], correctIndex: 1 },
  { id: 'g17', text: 'On which continent is the Amazon rainforest?', options: ['Africa', 'Asia', 'South America', 'Australia'], correctIndex: 2 },
  { id: 'g18', text: 'What is the capital of Kenya?', options: ['Mombasa', 'Nairobi', 'Kisumu', 'Nakuru'], correctIndex: 1 },
  { id: 'g19', text: 'Which sea is the saltiest?', options: ['Red Sea', 'Dead Sea', 'Black Sea', 'Caspian Sea'], correctIndex: 1 },
  { id: 'g20', text: 'What is the capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Ibadan'], correctIndex: 1 },
  { id: 'g21', text: 'Which country is both in Europe and Asia?', options: ['Greece', 'Turkey', 'Poland', 'Norway'], correctIndex: 1 },
  { id: 'g22', text: 'What is the capital of India?', options: ['Mumbai', 'Kolkata', 'New Delhi', 'Chennai'], correctIndex: 2 },
  { id: 'g23', text: 'Which river runs through London?', options: ['Severn', 'Thames', 'Mersey', 'Tyne'], correctIndex: 1 },
  { id: 'g24', text: 'What is the largest island in the world?', options: ['Borneo', 'Madagascar', 'Greenland', 'New Guinea'], correctIndex: 2 },
  { id: 'g25', text: 'Which continent is the coldest?', options: ['Europe', 'Asia', 'Antarctica', 'North America'], correctIndex: 2 },
];

/**
 * Intermediate: physical features, the capitals people usually get wrong, and how the Earth works.
 */
export const GEOGRAPHY_INTERMEDIATE: SeedQuestion[] = [
  { id: 'gi01', text: 'What is the imaginary line that divides Earth into north and south?', options: ['The Prime Meridian', 'The Equator', 'The Tropic of Cancer', 'The International Date Line'], correctIndex: 1 },
  // Zurich and Geneva are the famous wrong answers — neither is the capital.
  { id: 'gi02', text: 'What is the capital of Switzerland?', options: ['Zurich', 'Geneva', 'Bern', 'Basel'], correctIndex: 2 },
  { id: 'gi03', text: 'Which mountain range is usually taken as the border between Europe and Asia?', options: ['The Alps', 'The Urals', 'The Caucasus', 'The Carpathians'], correctIndex: 1 },
  { id: 'gi04', text: 'What is the largest lake in Africa?', options: ['Lake Chad', 'Lake Victoria', 'Lake Tanganyika', 'Lake Malawi'], correctIndex: 1 },
  { id: 'gi05', text: 'Which narrow strait separates Spain from Morocco?', options: ['The Strait of Gibraltar', 'The Bosporus', 'The Strait of Hormuz', 'The Bering Strait'], correctIndex: 0 },
  { id: 'gi06', text: 'What is a peninsula?', options: ['Land with water on three sides', 'A ring of coral', 'A river mouth', 'A range of hills'], correctIndex: 0 },
  { id: 'gi07', text: 'Which is the second-largest continent by area?', options: ['North America', 'Africa', 'Europe', 'Antarctica'], correctIndex: 1 },
  // Casablanca is the biggest city, which is why it is the usual wrong answer.
  { id: 'gi08', text: 'What is the capital of Morocco?', options: ['Casablanca', 'Marrakesh', 'Rabat', 'Fez'], correctIndex: 2 },
  { id: 'gi09', text: 'What is the imaginary line at 0° longitude called?', options: ['The Equator', 'The Prime Meridian', 'The Tropic of Capricorn', 'The Arctic Circle'], correctIndex: 1 },
  { id: 'gi10', text: 'Which ocean lies between Africa and Australia?', options: ['The Atlantic Ocean', 'The Pacific Ocean', 'The Indian Ocean', 'The Southern Ocean'], correctIndex: 2 },
  { id: 'gi11', text: 'What landform is made when a river drops sediment at its mouth?', options: ['A delta', 'A canyon', 'A fjord', 'A plateau'], correctIndex: 0 },
  // Istanbul is the largest city and the old capital; Ankara has been the capital since 1923.
  { id: 'gi12', text: 'What is the capital of Turkey?', options: ['Istanbul', 'Ankara', 'Izmir', 'Bursa'], correctIndex: 1 },
  { id: 'gi13', text: 'Which continent contains the most countries?', options: ['Asia', 'Europe', 'Africa', 'South America'], correctIndex: 2 },
  { id: 'gi14', text: 'What causes the seasons?', options: ['The Earth moving closer to the Sun', 'The tilt of the Earth’s axis', 'The Moon’s orbit', 'Changes in the Sun’s heat'], correctIndex: 1 },
  { id: 'gi15', text: 'Which country is completely surrounded by South Africa?', options: ['Eswatini', 'Botswana', 'Lesotho', 'Namibia'], correctIndex: 2 },
  { id: 'gi16', text: 'Which country has the longest coastline in the world?', options: ['Russia', 'Canada', 'Australia', 'Indonesia'], correctIndex: 1 },
  { id: 'gi17', text: 'What is the largest country in Africa by area?', options: ['Sudan', 'Egypt', 'Algeria', 'Nigeria'], correctIndex: 2 },
  { id: 'gi18', text: 'Which sea lies between Italy and the Balkan coast?', options: ['The Aegean Sea', 'The Adriatic Sea', 'The Ionian Sea', 'The Tyrrhenian Sea'], correctIndex: 1 },
  { id: 'gi19', text: 'What is the highest waterfall in the world?', options: ['Niagara Falls', 'Victoria Falls', 'Angel Falls', 'Iguazu Falls'], correctIndex: 2 },
  { id: 'gi20', text: 'Roughly what percentage of the Earth’s surface is covered by water?', options: ['50%', '60%', '70%', '90%'], correctIndex: 2 },
];

/**
 * Hard: named features, plate tectonics, and the capitals that even adults miss.
 */
export const GEOGRAPHY_HARD: SeedQuestion[] = [
  { id: 'gh01', text: 'Which two countries share the world’s longest international border?', options: ['Russia and China', 'Canada and the United States', 'Chile and Argentina', 'India and Bangladesh'], correctIndex: 1 },
  { id: 'gh02', text: 'Which river flows through the Grand Canyon?', options: ['The Mississippi', 'The Rio Grande', 'The Colorado', 'The Columbia'], correctIndex: 2 },
  { id: 'gh03', text: 'What was the name of the supercontinent that existed around 300 million years ago?', options: ['Gondwana', 'Pangaea', 'Laurasia', 'Rodinia'], correctIndex: 1 },
  // Gondwana and Laurasia are real, but they are the halves Pangaea later broke into.
  { id: 'gh04', text: 'Which is the driest desert in the world?', options: ['The Sahara', 'The Gobi', 'The Atacama', 'The Kalahari'], correctIndex: 2 },
  { id: 'gh05', text: 'Which is the deepest lake in the world?', options: ['Lake Superior', 'Lake Baikal', 'Lake Tanganyika', 'The Caspian Sea'], correctIndex: 1 },
  { id: 'gh06', text: 'What is the highest mountain in Africa?', options: ['Mount Kenya', 'Mount Kilimanjaro', 'Mount Elgon', 'The Rwenzori'], correctIndex: 1 },
  { id: 'gh07', text: 'What is a fjord?', options: ['A deep inlet carved by a glacier', 'A volcanic crater lake', 'A sandbar across a bay', 'A dry river valley'], correctIndex: 0 },
  // Auckland is the largest city, which is why almost everyone says it.
  { id: 'gh08', text: 'What is the capital of New Zealand?', options: ['Auckland', 'Christchurch', 'Wellington', 'Dunedin'], correctIndex: 2 },
  { id: 'gh09', text: 'Which strait separates the European and Asian sides of Istanbul?', options: ['The Dardanelles', 'The Bosporus', 'The Strait of Messina', 'The Kerch Strait'], correctIndex: 1 },
  { id: 'gh10', text: 'What is the name for a ring-shaped coral reef?', options: ['A cay', 'A reef flat', 'An atoll', 'A lagoon'], correctIndex: 2 },
  { id: 'gh11', text: 'Which two continents lie entirely in the southern hemisphere?', options: ['Africa and Australia', 'Antarctica and Australia', 'South America and Antarctica', 'Australia and Asia'], correctIndex: 1 },
  { id: 'gh12', text: 'Which trench contains the deepest known point in the ocean?', options: ['The Java Trench', 'The Puerto Rico Trench', 'The Mariana Trench', 'The Tonga Trench'], correctIndex: 2 },
  { id: 'gh13', text: 'Approximately what latitude is the Tropic of Cancer?', options: ['0°', '23.5° north', '23.5° south', '66.5° north'], correctIndex: 1 },
  { id: 'gh14', text: 'Which country borders the Caspian Sea to its south?', options: ['Iran', 'Turkey', 'Georgia', 'Uzbekistan'], correctIndex: 0 },
  { id: 'gh15', text: 'What are the steady winds that blow towards the Equator called?', options: ['The westerlies', 'The trade winds', 'The jet stream', 'The monsoon'], correctIndex: 1 },
  { id: 'gh16', text: 'Which lake is the largest freshwater lake by surface area?', options: ['Lake Victoria', 'Lake Baikal', 'Lake Superior', 'Lake Michigan'], correctIndex: 2 },
  { id: 'gh17', text: 'What is the capital of Myanmar?', options: ['Yangon', 'Mandalay', 'Naypyidaw', 'Bago'], correctIndex: 2 },
  { id: 'gh18', text: 'What is the boundary called where two tectonic plates slide past each other?', options: ['A constructive boundary', 'A destructive boundary', 'A conservative boundary', 'A collision boundary'], correctIndex: 2 },
  { id: 'gh19', text: 'Which African lake is shared by Tanzania, DR Congo, Burundi and Zambia?', options: ['Lake Victoria', 'Lake Malawi', 'Lake Tanganyika', 'Lake Turkana'], correctIndex: 2 },
  { id: 'gh20', text: 'What is the term for a river that flows into a larger river?', options: ['A tributary', 'A distributary', 'A meander', 'An estuary'], correctIndex: 0 },
];

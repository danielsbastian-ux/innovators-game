// Role-play content. Edit freely: characters, the speakable variants, town-meeting issues and chat prompts.

// ---------- The variant: something students actually SAY ----------
// The host picks one per game (or "random"). Innovators use it whenever they speak;
// students who adopt it are told to start using it too. Sociolinguists listen for it.
export const VARIANTS = {
  glim: {
    name: "New slang word: \"glim\"",
    type: "Vocabulary change",
    how: "Use the word \"glim\" to mean 'really good / great'.",
    examples: ["That idea is glim.", "The fish today? So glim.", "Your speech was totally glim!"],
    concept: "New words for 'really good' (cool, epic, fire…) spread when the group using them is admired.",
  },
  thf: {
    name: "th-fronting",
    type: "Pronunciation change",
    how: "Say 'th' as f or v: think → fink, three → free, brother → bruvver, with → wiv.",
    examples: ["I fink we should vote for the bridge.", "My bruvver works on the ferry.", "I've lived here free years."],
    concept: "A vernacular change spreading upwards through social groups (the chapter's example from British English).",
  },
  quot: {
    name: "New quotative: \"this is me\"",
    type: "Grammar change",
    how: "Introduce what someone said with \"this is me…\" / \"this is him/her…\" instead of 'I said / she said'.",
    examples: ["And this is me: 'No way!'", "This is her: 'The resort is a bad idea.'", "So this is him: 'I don't trust tourists.'"],
    concept: "A new quotative from a multi-ethnolect (Multicultural London English) in the chapter.",
  },
  uptalk: {
    name: "Uptalk",
    type: "Intonation change",
    how: "Make your voice RISE at the end of statements, as if asking a question, even when you aren't.",
    examples: ["I live near the harbour? ↗", "My family runs the café? ↗", "We need more jobs here? ↗"],
    concept: "High rising terminal (uptalk), described in the chapter as spreading in many Englishes.",
  },
  innit: {
    name: "Tag \"innit\"",
    type: "Grammar change",
    how: "Add \"innit?\" at the end of sentences, whatever the verb is.",
    examples: ["The ferry's late again, innit?", "You work at the bank, innit?", "We should stay together, innit?"],
    concept: "An invariant tag that ended up in the Milton Keynes koine, according to the chapter.",
  },
};
export const VARIANT_KEYS = Object.keys(VARIANTS);

// ---------- Characters ----------
export const JOBS = {
  harbour:  ["fisher on the family boat", "owner of the harbour café", "boat and net repairer", "ferry deckhand", "fish-market seller", "harbour master"],
  hillside: ["farmer on the family land", "goat keeper and cheese maker", "village schoolteacher", "owner of the hillside shop", "beekeeper", "village nurse"],
  market:   ["phone and SIM-card seller", "food-stall owner", "bus driver to the mainland", "bank clerk", "souvenir-shop owner", "hotel receptionist"],
  campus:   ["first-year student from the mainland", "linguistics lecturer", "campus radio DJ", "student union leader", "library assistant", "exchange student"],
};
export const ATTITUDES = {
  harbour:  "You are proud of island life and a bit suspicious of tourists and mainland people.",
  hillside: "You value old local ways, family and loyalty. Change from outside worries you.",
  market:   "You like business and visitors. More contact with the mainland means more customers.",
  campus:   "You love new trends and ideas, and you're in touch with the mainland and social media.",
};
export const GOALS = [
  "You want to keep the island's traditions alive.",
  "You dream of moving to the mainland for a better job.",
  "You want more tourists, because they're good for business.",
  "You want to be popular with the younger crowd.",
  "You want peace and quiet, and fewer outsiders.",
  "You want the island to modernise: faster internet, better roads.",
  "You want to be respected as a 'real' local.",
  "You want to become famous online.",
];
export const AGE_NOTES = {
  "Teens": "You care a lot about what your friends think, and you pick up new expressions quickly.",
  "20s–30s": "You're building your career, so you need to get on with lots of different people.",
  "40s–50s": "You have a family and responsibilities. You're careful about how you speak in public.",
  "60+": "You remember how people used to talk here, and you notice when the young talk 'strangely'.",
};

// ---------- Face-to-face conversation prompts (one per round) ----------
export const PROMPTS = [
  "Introduce your character: who are you, and what do you do on the island?",
  "What do you think about the tourists who come every summer?",
  "Would you ever move to the mainland? Why or why not?",
  "What's the best and the worst thing about living here?",
  "Who on the island do you admire, and why?",
  "How have things changed on the island since you were younger?",
];

// ---------- Town-meeting issues (one per round) ----------
export const ISSUES = [
  { title: "A big tourist resort on the beach?", text: "A mainland company wants to build a resort. It means jobs, but also thousands of summer visitors.", concept: "Contact with outsiders, and locals using speech to show identity (like on Martha's Vineyard)." },
  { title: "Close the Hillside village school?", text: "Children would take the bus to the bigger school in Market Town every day.", concept: "New networks and interaction: children mixing with other groups pick up new forms." },
  { title: "A bridge to the mainland?", text: "No more ferry: anyone could drive in and out at any time.", concept: "Isolation keeps speech conservative (as with Icelandic). What happens when it ends?" },
  { title: "An island TV and radio station?", text: "The campus wants to launch a station with mainland pop stars and presenters.", concept: "Media vs face-to-face: can TV alone change how people speak?" },
  { title: "Campus expansion onto farmland?", text: "The university wants to build new dorms on Hillside fields for 2,000 mainland students.", concept: "Newcomers + locals = dialect contact (koineisation)." },
  { title: "English-only signs for tourists?", text: "Market Town traders want shop and street signs only in the 'standard' variety.", concept: "Overt prestige vs covert prestige: whose speech counts as 'good'?" },
];

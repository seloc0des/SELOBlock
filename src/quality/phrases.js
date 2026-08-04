// Boilerplate phrase list for the quality scorer.
//
// Kept deliberately short and versioned. Bumping PHRASE_LIST_VERSION when this
// list changes lets label records record which list produced which score, so a
// later accuracy shift can be attributed to a phrase-list change rather than a
// weights change. See src/quality/score.js for WEIGHTS_VERSION.
//
// Match is case-insensitive substring against the page's visible text. Keep
// entries lowercase.

export const PHRASE_LIST_VERSION = 1;

export const BOILERPLATE_PHRASES = [
  "in today's fast-paced",
  'in the ever-evolving',
  "let's dive in",
  'look no further',
  'when it comes to',
  "it's important to note",
  'in conclusion',
];

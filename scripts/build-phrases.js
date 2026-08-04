// Build-time sync for the content-script boilerplate phrase list.
//
//   node scripts/build-phrases.js
//
// The scanner in src/content/quality-scan.js is a classic content script and
// cannot import ES modules, so it carries a copy of the phrase list and version.
// src/quality/phrases.js is the single source of truth; this script regenerates
// the copied block (between the GENERATED PHRASES markers) so the two can never
// drift. Mirrors scripts/build-psl.js.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PHRASE_LIST_VERSION, BOILERPLATE_PHRASES } from '../src/quality/phrases.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(root, 'src/content/quality-scan.js');
const BEGIN = '  // BEGIN GENERATED PHRASES -- do not edit by hand.';
const END = '  // END GENERATED PHRASES';

// Render one phrase as a JS string literal. Prefer single quotes; fall back to
// double quotes when the phrase itself contains an apostrophe (matches the
// existing hand-written style, e.g. "let's dive in").
function literal(s) {
  return s.includes("'") ? JSON.stringify(s) : `'${s}'`;
}

function block() {
  const items = BOILERPLATE_PHRASES.map((p) => `    ${literal(p)},`).join('\n');
  return [
    BEGIN,
    `  const PHRASE_LIST_VERSION = ${PHRASE_LIST_VERSION};`,
    '  const BOILERPLATE_PHRASES = [',
    items,
    '  ];',
    END,
  ].join('\n');
}

async function main() {
  const src = await readFile(TARGET, 'utf8');
  const start = src.indexOf(BEGIN);
  const end = src.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find GENERATED PHRASES markers in ${TARGET}`);
  }
  const next = src.slice(0, start) + block() + src.slice(end + END.length);
  if (next === src) {
    console.log('Phrase block already up to date.');
    return;
  }
  await writeFile(TARGET, next, 'utf8');
  console.log(`Synced ${BOILERPLATE_PHRASES.length} phrases (v${PHRASE_LIST_VERSION}) into ${TARGET}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

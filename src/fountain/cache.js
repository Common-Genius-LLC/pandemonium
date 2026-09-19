// Per-script parse memoization, keyed on text identity, so switching panels
// or re-rendering doesn't re-run the parser on unchanged scripts. Same
// scheme as the original PCACHE.
'use strict';

import { parseFountain } from './parse.js';

const CACHE = new Map();

export function getParsed(script) {
  const c = CACHE.get(script.id);
  if (c && c.text === script.text) return c.parsed;
  const parsed = parseFountain(script.text);
  CACHE.set(script.id, { text: script.text, parsed });
  return parsed;
}

export function clearParseCache() {
  CACHE.clear();
}

// Parse by text, for callers that hold a document rather than a script record
// (the editor's highlighter and its page layout both parse the live document
// on every keystroke; keyed on the text, the second of them gets the first's
// result instead of parsing a 100-page script again). A few entries, because
// two editors can show two drafts at once.
const TEXT_CACHE = [];
export function parseText(text) {
  for (const e of TEXT_CACHE) if (e.text === text) return e.parsed;
  const parsed = parseFountain(text);
  TEXT_CACHE.unshift({ text, parsed });
  if (TEXT_CACHE.length > 4) TEXT_CACHE.pop();
  return parsed;
}

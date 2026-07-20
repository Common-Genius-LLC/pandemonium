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

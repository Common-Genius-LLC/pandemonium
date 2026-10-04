// Per-script parse memoization, keyed on text identity, so switching panels
// or re-rendering doesn't re-run the parser on unchanged scripts. Same
// scheme as the original PCACHE.
//
// Which parser runs is the draft's own business: a Fountain draft is parsed as
// Fountain, a plain-text or Markdown one as paragraphs (fountain/plain.js).
// Everything downstream reads `parsed.blocks` and does not care which it was.
'use strict';

import { parseFountain } from './parse.js';
import { parsePlain } from './plain.js';
import { formatOf, isFountain, isMarkdown } from '../data/formats.js';

function parseAs(text, format) {
  if (isFountain(format)) return parseFountain(text);
  return parsePlain(text, { emphasis: isMarkdown(format) });
}

const CACHE = new Map();

export function getParsed(script) {
  const format = formatOf(script);
  const c = CACHE.get(script.id);
  if (c && c.text === script.text && c.format === format) return c.parsed;
  const parsed = parseAs(script.text, format);
  CACHE.set(script.id, { text: script.text, format, parsed });
  return parsed;
}

export function clearParseCache() {
  CACHE.clear();
}

// Parse by text, for callers that hold a document rather than a script record
// (the editor's highlighter and its page layout both parse the live document
// on every keystroke; keyed on the text, the second of them gets the first's
// result instead of parsing a 100-page script again). A few entries, because
// two editors can show two drafts at once. The format comes from the editor's
// own state (scriptFormat in components/editor/cm-format.js); callers with no
// opinion get Fountain, which is what every caller meant before formats
// existed.
const TEXT_CACHE = [];
export function parseText(text, format = 'fountain') {
  for (const e of TEXT_CACHE) if (e.text === text && e.format === format) return e.parsed;
  const parsed = parseAs(text, format);
  TEXT_CACHE.unshift({ text, format, parsed });
  if (TEXT_CACHE.length > 4) TEXT_CACHE.pop();
  return parsed;
}

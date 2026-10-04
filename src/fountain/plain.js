// Parsing a draft that is NOT Fountain: plain text, or Markdown.
//
// A draft can be written in plain text (which is what a new one starts as),
// Markdown, or Fountain (see data/formats.js). Everything downstream of the
// parser works on `parsed.blocks`, so the cheapest honest way to support the
// other two formats is to hand that machinery the same shape: one block per
// non-blank line, every one a paragraph.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It reads nothing into the text. A line of
// capitals is not a character cue, a line ending in "TO:" is not a transition,
// a leading dot does not force a scene heading, `/* */` is not a boneyard and
// `[[ ]]` is not a note. Those readings are what Fountain IS, and applying them
// to prose is exactly the bug this format setting exists to fix: the writer who
// types "THE END." in a plain note should not watch it become a character cue.
// Hard rule 2 is about never corrupting a Fountain document; a plain-text
// document has the same claim on being left alone.
//
// Markdown shares this parse. Its markers (`#`, `-`, `>`) stay in the text and
// are coloured by the editor (cm-markdown.js) rather than being cut out here,
// because the page is a character grid: a heading that changed size would no
// longer fit the row it is laid out on.
//
// Emphasis is the one thing read inline, and only for Markdown: `**bold**` and
// `*italic*` mean the same thing in Markdown as in Fountain, so the same
// inlineRuns gives Markdown its bold and italic and gives `.plain` the text
// without the asterisks. Plain text keeps every character it has.
'use strict';

import { inlineRuns } from './parse.js';

// One run covering the whole line, with the identity map `.plain` and
// plainToRaw need: for plain text what is stored is what is drawn.
function literalRuns(text) {
  return [{ t: text, b: false, i: false, u: false, n: false, map: [...text].map((_, k) => k) }];
}

export function parsePlain(text, { emphasis = false } = {}) {
  const lines = String(text == null ? '' : text).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    // The text as it stands, minus only the indentation, which is what every
    // other block's `.text` is relative to (textOffset below).
    const t = raw.replace(/\s+$/, '');
    const lead = t.length - t.trimStart().length;
    const body = t.slice(lead);
    const b = {
      type: 'action',
      text: body,
      scene: 0,
      i: blocks.length,
      line: i,
      textOffset: lead,
    };
    b.runs = emphasis ? inlineRuns(body) : literalRuns(body);
    b.plain = b.runs.map((r) => r.t).join('');
    b.words = b.plain.split(/\s+/).filter(Boolean).length;
    const plainToRaw = new Array(b.plain.length);
    let pos = 0;
    for (const r of b.runs) { for (const rawIdx of r.map) { plainToRaw[pos] = rawIdx; pos++; } }
    b.plainToRaw = plainToRaw;
    blocks.push(b);
  }
  // No title page: `Title:` on the first line of a note is a line of a note.
  return { title: {}, blocks };
}

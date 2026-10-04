// What a draft is written IN.
//
// Pandemonium is built around Fountain, and the final draft of a screenplay is
// a Fountain document. But a draft is not always a screenplay yet: the first
// one is usually a page of prose, a treatment, an outline, a list of beats. Read
// as Fountain, that prose is quietly rewritten in front of the writer, because
// Fountain reads meaning into shapes that ordinary prose has by accident: a
// line in capitals becomes a character cue, a line ending in "TO:" becomes a
// transition, a leading dot forces a scene heading, `/* */` disappears into a
// boneyard. Hence this: a format per draft, so each one is read as what it is.
//
//   text      read as nothing. Every line is a paragraph, every character is
//             itself. This is what a NEW draft starts as.
//   markdown  the same parse, plus `**bold**` and `*italic*`, with the markers
//             coloured where they stand (see cm-markdown.js).
//   fountain  the screenplay format, with everything the app does for it.
//
// A draft from a file written before this setting existed has no `format` key
// and reads as FOUNTAIN. That is what those drafts are: they were written in a
// Fountain editor and their text means what Fountain says it means. Defaulting
// them to plain text would silently restyle every screenplay already saved.
'use strict';

export const FORMATS = [
  { key: 'text', label: 'Plain text', hint: 'Every line a paragraph. Nothing is read into the text.' },
  { key: 'markdown', label: 'Markdown', hint: 'Headings, lists, bold and italic, coloured where they stand.' },
  { key: 'fountain', label: 'Fountain', hint: 'The screenplay format: scenes, cues, dialogue, transitions.' },
];

export const DEFAULT_FORMAT = 'text';
export const LEGACY_FORMAT = 'fountain';

const KEYS = FORMATS.map((f) => f.key);

export function isFormat(key) {
  return KEYS.includes(key);
}

// A script record's format. Unset means Fountain (see the note above), and
// anything unrecognised (a newer file, a hand-edited one) means Fountain too,
// which is the reading that cannot lose a screenplay's formatting.
export function formatOf(script) {
  const key = script && script.format;
  return isFormat(key) ? key : LEGACY_FORMAT;
}

export function formatLabel(key) {
  const f = FORMATS.find((x) => x.key === key);
  return f ? f.label : formatLabel(LEGACY_FORMAT);
}

// Which of the app's Fountain machinery a format gets. Only Fountain gets the
// element flow (the picker, Tab transforms, auto-uppercase, the summary
// default, the live preview that hides its own markers); only Fountain and
// Markdown share emphasis, since `**bold**` means the same in both.
export function isFountain(key) { return key === 'fountain'; }
export function isMarkdown(key) { return key === 'markdown'; }
export function hasEmphasis(key) { return key === 'fountain' || key === 'markdown'; }

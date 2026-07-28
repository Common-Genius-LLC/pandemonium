// Manual inline emphasis (bold, italic, underline).
//
// Fountain expresses emphasis in the source itself (**bold**, *italic*,
// _underline_), so applying it is a text edit and nothing else. Everything
// downstream already exists: parse.js inlineRuns() reads these runs,
// blocks.js blockHTML() renders them, and cm-fountain-plugin.js already
// decorates them live and conceals the delimiters off the caret line. Nothing
// in the parser needs to change to support this feature.
//
// Pure and DOM-free so the toggle can be tested against a real parse instead
// of a mocked editor view.
'use strict';

export const MARKERS = { bold: '**', italic: '*', underline: '_' };

// Which elements accept manual emphasis. Deliberately a whitelist, not a
// blacklist of the obviously bad ones.
//
// The elements left out are the ones whose PARSE depends on their exact text.
// A character cue is recognised by being upper-case, a transition by its "TO:"
// suffix, a scene heading by its prefix, a parenthetical by its brackets.
// Injecting delimiters into any of those risks changing what the line IS, not
// just how it looks, and hard rule 2 makes that a bug rather than a trade-off.
// A whitelist fails safe: an element added to the parser later is not silently
// formattable until someone decides it should be.
export const FORMATTABLE = new Set(['action', 'dialogue', 'centered', 'lyric', 'synopsis']);

export function canFormat(element) { return FORMATTABLE.has(element); }

const STAR = '*';

function starsBefore(text, pos) {
  let n = 0;
  while (pos - n - 1 >= 0 && text[pos - n - 1] === STAR) n++;
  return n;
}

function starsAfter(text, pos) {
  let n = 0;
  while (pos + n < text.length && text[pos + n] === STAR) n++;
  return n;
}

// Toggle `marker` around [from, to) of `text`. Returns the new text and where
// the selection should land, so the caret keeps the same words whether the
// call wrapped or unwrapped. An empty selection wraps nothing and parks the
// caret between the delimiters, so pressing bold and then typing produces bold
// text the way it does in any other editor.
export function toggleMarker(text, from, to, marker) {
  return marker === MARKERS.bold || marker === MARKERS.italic
    ? toggleStars(text, from, to, marker)
    : toggleSimple(text, from, to, marker);
}

// Bold and italic share one delimiter character, so they cannot be toggled
// independently by counting a fixed number of asterisks: `*` is italic, `**`
// is bold and `***` is both, and treating them as separate wrappers makes
// italic-next-to-bold eat one of bold's asterisks and silently demote it.
//
// The run of asterisks on each side is therefore read as a single state (0 to
// 3), the requested style is flipped within that state, and the run is
// rewritten. Which is also how the two toggles compose the way a writer
// expects: italic over bold gives bold-italic, and turning bold back off
// leaves the italic behind rather than stripping both.
function toggleStars(text, from, to, marker) {
  // A selection that includes its own delimiters behaves like one that merely
  // abuts them, so selecting a whole `**word**` and pressing bold turns it off
  // rather than nesting another pair around it.
  let s = from, e = to;
  while (s < e && text[s] === STAR) s++;
  while (e > s && text[e - 1] === STAR) e--;

  // Only a symmetric run is a delimiter pair. Taking the minimum means a stray
  // asterisk on one side is treated as text, not as half a delimiter.
  const run = Math.min(3, starsBefore(text, s), starsAfter(text, e));
  const bold = run === 2 || run === 3;
  const italic = run === 1 || run === 3;

  const wantBold = marker === MARKERS.bold ? !bold : bold;
  const wantItalic = marker === MARKERS.italic ? !italic : italic;
  const next = STAR.repeat((wantBold ? 2 : 0) + (wantItalic ? 1 : 0));

  const head = text.slice(0, s - run) + next;
  const body = text.slice(s, e);
  return { text: head + body + next + text.slice(e + run), from: head.length, to: head.length + body.length };
}

// Underline has a delimiter of its own and no overlapping meanings, so it is
// the plain wrap/unwrap case.
function toggleSimple(text, from, to, marker) {
  const n = marker.length;
  let s = from, e = to;
  if (e - s >= n * 2 && text.startsWith(marker, s) && text.endsWith(marker, e)) { s += n; e -= n; }
  const body = text.slice(s, e);

  if (s >= n && text.slice(s - n, s) === marker && text.slice(e, e + n) === marker) {
    const head = text.slice(0, s - n);
    return { text: head + body + text.slice(e + n), from: head.length, to: head.length + body.length };
  }
  const head = text.slice(0, s) + marker;
  return { text: head + body + marker + text.slice(e), from: head.length, to: head.length + body.length };
}

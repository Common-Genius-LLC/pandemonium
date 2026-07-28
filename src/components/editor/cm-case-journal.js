// Non-destructive formatting: Shift+Tab returns a line to the casing and
// format it had before an element was applied to it.
//
// Setting a line's element rewrites it (applyElement in
// fountain/element-ops.js): it adds forcing markup and, for scene headings,
// character cues and transitions, upper-cases the text. It then pins the
// element so autoUppercase keeps upper-casing whatever you type next. That is
// a lossy edit, and until this field existed it was unrecoverable: the
// writer's own casing was simply gone.
//
// Two state fields, both keyed by line position and both mapped through
// document changes the way activeElementField maps its pin:
//
//   caseJournal  what the line said before the transform (`before`), what the
//                transform left behind (`after`), how many characters of
//                separator were inserted above it, and whether the applied
//                element upper-cases. Enough to undo the whole transform in
//                one step, markup included.
//   caseExempt   a line autoUppercase must leave alone. Without it a
//                just-reverted line is re-upper-cased by the very next
//                keystroke and the revert looks like it never happened.
//
// Both are dropped once the caret leaves the line, so neither grows and
// neither can reach back into a line the writer has moved on from.
//
// Why `upper` makes the revert exact rather than a guess: while a line is
// pinned to an upper-casing element, the writer CANNOT type a lower-case
// character, because autoUppercase rewrites the line inside the same
// transaction as the keystroke. So every capital on such a line is the
// editor's doing, not the writer's, and lower-casing what was typed after the
// transform is restoring it rather than second-guessing it.
'use strict';

import { StateField, StateEffect } from '@codemirror/state';

export const recordOriginal = StateEffect.define();  // {pos, before, after, sep, upper} | null
export const exemptFromUpper = StateEffect.define(); // pos | null

function caretLeft(pos, tr) {
  if (pos == null || !tr.selection) return false;
  const doc = tr.newDoc;
  const here = doc.lineAt(tr.newSelection.main.head).from;
  return here !== doc.lineAt(Math.min(pos, doc.length)).from;
}

export const caseJournal = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) value = { ...value, pos: tr.changes.mapPos(value.pos, -1) };
    for (const e of tr.effects) if (e.is(recordOriginal)) value = e.value;
    if (value && caretLeft(value.pos, tr)) value = null;
    return value;
  },
});

export const caseExempt = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value != null && tr.docChanged) value = tr.changes.mapPos(value, -1);
    for (const e of tr.effects) if (e.is(exemptFromUpper)) value = e.value;
    if (value != null && caretLeft(value, tr)) value = null;
    return value;
  },
});

// The journal entry for the line the caret is on, or null.
export function journalAtCaret(state) {
  const entry = state.field(caseJournal, false);
  if (!entry) return null;
  const doc = state.doc;
  const line = doc.lineAt(state.selection.main.head);
  return line.from === doc.lineAt(Math.min(entry.pos, doc.length)).from ? entry : null;
}

export function isExempt(state, lineFrom) {
  const pos = state.field(caseExempt, false);
  if (pos == null) return false;
  return state.doc.lineAt(Math.min(pos, state.doc.length)).from === lineFrom;
}

// What reverting an element transform should write, or null when the line has
// drifted too far from what the transform left for the undo to be exact.
//
// Pure (a plain line text and a journal entry, no view) because the whole risk
// here is silently mangling a line the writer has since edited, and that is
// worth testing without a DOM.
//
// The line must still START with what the transform produced. Anything typed
// since is a suffix and is carried over, lower-cased when the element was an
// upper-casing one (see the note at the top of this file). If the writer edited
// inside the transformed text instead, the prefix no longer matches, this
// returns null, and Shift+Tab falls back to its other meaning rather than
// rewriting text it can no longer account for.
export function revertPlan(lineText, entry) {
  if (!entry || !lineText.startsWith(entry.after)) return null;
  const tail = lineText.slice(entry.after.length);
  const text = entry.before + (entry.upper ? tail.toLowerCase() : tail);
  if (text === lineText && !entry.sep) return null;
  return { text, sep: entry.sep || 0 };
}

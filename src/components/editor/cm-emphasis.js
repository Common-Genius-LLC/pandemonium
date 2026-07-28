// Manual bold / italic / underline in the script editor.
//
// The logic is in fountain/inline-format.js (pure); this file is the thin
// CodeMirror binding. Nothing here needs a decoration or a theme rule: the
// Fountain plugin already styles emphasis runs and conceals their delimiters,
// so writing the markers into the source is the entire feature.
'use strict';

import { keymap } from '@codemirror/view';
import { MARKERS, canFormat, toggleMarker } from '../../fountain/inline-format.js';
import { activeElementField, caretElementFor } from './cm-autoformat.js';

function pinOn(state, line) {
  const active = state.field(activeElementField, false);
  if (!active) return null;
  return state.doc.lineAt(Math.min(active.pos, state.doc.length)).from === line.from ? active.el : null;
}

// The element a line will be read as, which is what decides whether it accepts
// emphasis. Uses the same caretElementFor the picker uses, so the guard can
// never disagree with the element the editor is showing.
export function elementOfLine(state, parsed, line) {
  return caretElementFor(state.doc, parsed, line.number - 1, pinOn(state, line));
}

// True when emphasis can be applied anywhere in the current selection. Read by
// the selection toolbar to disable its B/I/U buttons, so the restriction is
// visible rather than a keystroke that silently does nothing.
export function canFormatSelection(view, getParsed) {
  const { state } = view;
  const parsed = getParsed(view);
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from).number;
  const last = state.doc.lineAt(sel.to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (line.text.trim() && canFormat(elementOfLine(state, parsed, line))) return true;
  }
  return false;
}

// Applies emphasis line by line, SKIPPING any line whose element does not
// accept it rather than refusing the whole command. For a selection that spans
// a character cue and its speech, that means the speech gets its emphasis and
// the cue is left intact, which is what the writer meant. Refusing outright
// would make the feature unusable on exactly the selections people make.
export function toggleEmphasis(view, kind, getParsed) {
  const marker = MARKERS[kind];
  if (!marker) return false;
  const { state } = view;
  const parsed = getParsed(view);
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from).number;
  const last = state.doc.lineAt(sel.to).number;

  const changes = [];
  let nextSel = null;

  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (!line.text.trim()) continue;
    if (!canFormat(elementOfLine(state, parsed, line))) continue;

    // Clamp the selection to this line. A multi-line selection formats the
    // part of each line it actually covers, not the whole line.
    const from = Math.max(sel.from, line.from) - line.from;
    const to = Math.min(sel.to, line.to) - line.from;
    const out = toggleMarker(line.text, from, to, marker);
    if (out.text === line.text) continue;
    changes.push({ from: line.from, to: line.to, insert: out.text });
    if (!nextSel) nextSel = { anchor: line.from + out.from, head: line.from + out.to };
  }

  if (!changes.length) return false;
  view.dispatch({ changes, selection: nextSel || undefined, userEvent: 'input' });
  return true;
}

// Bound before the default keymap for the same reason elementKeymap is: so the
// ordering of the editor's own bindings stays in one predictable place.
export function emphasisKeymap({ getParsed }) {
  return keymap.of([
    { key: 'Mod-b', run: (v) => toggleEmphasis(v, 'bold', getParsed) },
    { key: 'Mod-i', run: (v) => toggleEmphasis(v, 'italic', getParsed) },
    { key: 'Mod-u', run: (v) => toggleEmphasis(v, 'underline', getParsed) },
  ]);
}

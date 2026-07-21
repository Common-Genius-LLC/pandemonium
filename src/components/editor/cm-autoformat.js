// "Format as you go" (notes.md, follow-up): make the script stylise itself
// while typing, the way Final Draft does, WITHOUT leaving the Fountain source.
// Two safe pieces only -- no Enter/Tab remap, so the editing you prioritised is
// untouched:
//
//   1. Scene headings and transitions upper-case their own text as you type.
//      The parser recognises those case-insensitively (INT./EXT..., "> ...",
//      "... TO:"), so we can normalise them the moment they're recognisable.
//   2. When you set a line's element from the picker to one that's
//      conventionally upper-case (Character / Scene / Transition), that choice
//      is "pinned" to the line so it keeps upper-casing as you keep typing --
//      which is how a lower-cased character name becomes a real cue.
//
// It runs as a transactionFilter: the upper-casing rides along in the SAME
// transaction as your keystroke (one undo step) and is length-preserving, so
// the caret never jumps.
'use strict';

import { StateField, StateEffect, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { applyElement, elementOfBlock } from '../../fountain/element-ops.js';

const UPPER = new Set(['scene', 'character', 'transition']);
const SCENE_RE = /^(INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s]/i;

// Tab cycles through the elements you meet while writing a scene; Enter drops
// you into the element that naturally follows the current one (Final Draft's
// two-key flow). Both are keyed off the parser's block types (element-ops.js).
const TAB_CYCLE = ['action', 'character', 'dialogue', 'paren', 'scene', 'transition'];
const NEXT_ON_ENTER = {
  scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue',
  dialogue: 'dialogue', transition: 'scene', centered: 'action', lyric: 'lyric',
  section: 'action', synopsis: 'action',
};

// {el, pos} pins an element to a line (pos = line start, mapped through edits);
// null follows the parser's own detection.
export const setActiveElement = StateEffect.define();

export const activeElementField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) value = { el: value.el, pos: tr.changes.mapPos(value.pos, -1) };
    for (const e of tr.effects) if (e.is(setActiveElement)) value = e.value;
    // Drop the pin once the caret leaves that line.
    if (value && tr.selection) {
      const doc = tr.newDoc;
      const head = tr.newSelection.main.head;
      if (doc.lineAt(head).from !== doc.lineAt(Math.min(value.pos, doc.length)).from) value = null;
    }
    return value;
  },
});

function upperElementFor(lineText, active) {
  if (active && UPPER.has(active)) return active;
  const t = lineText.trim();
  if (!t) return null;
  if ((t[0] === '.' && t[1] !== '.') || SCENE_RE.test(t)) return 'scene';
  if (t[0] === '>' && !/<\s*$/.test(t)) return 'transition';           // "> CUT TO" (not centered "> x <")
  if (/TO:\s*$/.test(t) && t === t.toUpperCase()) return 'transition';
  return null;
}

export const autoUppercase = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input')) return tr;
  const line = tr.newDoc.lineAt(tr.newSelection.main.head);
  let active = tr.startState.field(activeElementField, false);
  if (active) {
    const pos = Math.min(tr.changes.mapPos(active.pos, -1), tr.newDoc.length);
    active = tr.newDoc.lineAt(pos).from === line.from ? active.el : null;
  }
  if (!upperElementFor(line.text, active)) return tr;
  const upper = line.text.toUpperCase();
  if (upper === line.text) return tr;
  return [tr, { changes: { from: line.from, to: line.to, insert: upper }, sequential: true }];
});

export function pinsUpperCase(key) { return UPPER.has(key); }

// The element under the caret: a Tab/picker pin on this line wins, else the
// parser's block type. `getParsed(view)` returns the shared fountain parse.
function caretElement(view, getParsed, line0) {
  const active = view.state.field(activeElementField, false);
  if (active) {
    const doc = view.state.doc;
    const pinLine = doc.lineAt(Math.min(active.pos, doc.length)).number - 1;
    if (pinLine === line0) return active.el;
  }
  const parsed = getParsed(view);
  const b = parsed && parsed.blocks.find((x) => x.line === line0);
  return elementOfBlock(b);
}

function setLine(view, line, key) {
  const next = applyElement(line.text, key);
  view.dispatch({
    changes: next !== line.text ? { from: line.from, to: line.to, insert: next } : undefined,
    selection: { anchor: line.from + next.length },
    effects: setActiveElement.of(UPPER.has(key) ? { el: key, pos: line.from } : null),
  });
  return true;
}

function cycle(view, getParsed, dir) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const cur = caretElement(view, getParsed, line.number - 1);
  let idx = TAB_CYCLE.indexOf(cur);
  if (idx < 0) idx = dir > 0 ? -1 : 0;
  return setLine(view, line, TAB_CYCLE[(idx + dir + TAB_CYCLE.length) % TAB_CYCLE.length]);
}

function smartEnter(view, getParsed) {
  const sel = view.state.selection.main;
  const cur = caretElement(view, getParsed, view.state.doc.lineAt(sel.from).number - 1);
  const nextEl = NEXT_ON_ENTER[cur] || null;
  const caret = sel.from + 1; // after the inserted newline
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: '\n' },
    selection: { anchor: caret },
    effects: setActiveElement.of(nextEl && UPPER.has(nextEl) ? { el: nextEl, pos: caret } : null),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

// Must sit BEFORE the default keymap so Tab/Enter reach here first. Tab is
// captured for element flow (screenplay editors do this); panel-focus
// shortcuts will live elsewhere.
export function elementKeymap({ getParsed }) {
  return keymap.of([
    { key: 'Tab', run: (v) => cycle(v, getParsed, 1), shift: (v) => cycle(v, getParsed, -1) },
    { key: 'Enter', run: (v) => smartEnter(v, getParsed) },
  ]);
}

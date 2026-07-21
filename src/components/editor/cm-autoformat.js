// "Format as you go" (notes.md, follow-up): make the script stylise itself
// while typing, the way Final Draft does, WITHOUT leaving the Fountain source.
// Four pieces:
//
//   1. Scene headings and transitions upper-case their own text as you type.
//      The parser recognises those case-insensitively (INT./EXT..., "> ...",
//      "... TO:"), so we can normalise them the moment they're recognisable.
//   2. When you set a line's element (picker or Tab), that choice is "pinned"
//      to the line: it keeps upper-casing as you keep typing (which is how a
//      lower-cased character name becomes a real cue) and it is what the
//      picker reports, until the caret leaves the line.
//   3. Tab cycles elements; Enter moves you into the element that follows the
//      current one.
//   4. Enter and the element picker write the blank line that ENDS a Fountain
//      block when the new element cannot legally sit under the old one (see
//      CONTIGUOUS_AFTER / elementSeparator). Without that, the file keeps
//      meaning "still dialogue" while the editor shows you an action line,
//      and the formatting snaps back to dialogue the moment you type.
//
// The upper-casing runs as a transactionFilter: it rides along in the SAME
// transaction as your keystroke (one undo step) and is length-preserving, so
// the caret never jumps.
'use strict';

import { StateField, StateEffect, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { applyElement, applyElementTo, elementOfBlock, isBareMarkup } from '../../fountain/element-ops.js';
import { isCharacterCueText } from '../../fountain/parse.js';
import { openElementMenu } from './element-menu.js';

const UPPER = new Set(['scene', 'character', 'transition']);
const SCENE_RE = /^(INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s]/i;

// Tab cycles the elements a line can START as. Dialogue and parenthetical are
// deliberately NOT in the cycle: neither means anything without a character
// cue above it, so tabbing a bare line into one would just produce a line the
// parser reads as action. You reach them the way you do in a real script
// program, off the cue itself (see cycle(): Tab from a written cue opens a
// parenthetical, Tab again drops into the speech) or from the element menu.
const TAB_CYCLE = ['action', 'character', 'transition', 'scene'];
const NEXT_ON_ENTER = {
  scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue',
  dialogue: 'action', transition: 'scene', centered: 'action', lyric: 'lyric',
  section: 'action', section2: 'action', section3: 'action',
  synopsis: 'action', note: 'action',
};

// Which elements may sit on the line DIRECTLY under another one. Fountain
// separates elements with a blank line; the exceptions are a character cue's
// own run (cue, parentheticals and speech are one uninterrupted block) and
// consecutive lyrics.
//
// This is not cosmetic. parseFountain swallows every non-blank line under a
// cue into that cue's dialogue, and only recognises a cue when a blank line
// precedes it, so a line typed straight under dialogue IS dialogue as far as
// the file is concerned, whatever the editor happens to be showing at the
// time. Enter therefore has to emit the blank line that actually ends the
// block, rather than leaving the caret somewhere the parser will re-read as
// speech the moment a character is typed.
const CONTIGUOUS_AFTER = { character: ['dialogue', 'paren'], paren: ['dialogue', 'paren'], lyric: ['lyric'] };
const DIALOGUE_FAMILY = new Set(['dialogue', 'paren']);

function needsBlankLine(cur, next) {
  const ok = CONTIGUOUS_AFTER[cur];
  return !(ok && ok.includes(next));
}

function lineBlank(doc, n) { return n < 1 || n > doc.lines || doc.line(n).text.trim() === ''; }

// Is `lineNo` (1-based) part of a character cue's dialogue run? Walks up to
// the first line of the unbroken run it belongs to and asks the parser's own
// cue test, so this cannot drift from what parseFountain will decide.
function inDialogueRun(doc, lineNo) {
  let n = lineNo - 1;
  if (lineBlank(doc, n)) return false;
  while (n > 1 && !lineBlank(doc, n - 1)) n--;
  return isCharacterCueText(doc.line(n).text.trim());
}

// Text to insert BEFORE a line that is being turned into `key`, so the file
// really contains that element. Applying "Transition" to a line inside a
// dialogue run, or "Character" under a non-blank line, is otherwise a claim
// the source does not back: the picker would relabel the line while the
// parser kept reading it as speech.
export function elementSeparator(doc, line, key) {
  if (line.number === 1 || lineBlank(doc, line.number - 1)) return '';
  if (key === 'character') return '\n';
  if (DIALOGUE_FAMILY.has(key)) return '';
  return inDialogueRun(doc, line.number) ? '\n' : '';
}

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

// A pin (Tab / picker / Enter) always drives the caret line's element display,
// but it may only override the PARSER's verdict on a line that already has
// text for the two elements the parser cannot judge from that line alone: a
// character cue (it needs the dialogue under it before it is a cue) and a bare
// forced-scene '.' with nothing typed after it yet. Anywhere else the parser
// wins, so the editor never shows an element the saved file would not contain.
const PIN_OVERRIDES = new Set(['character', 'scene']);
export function pinOverridesParser(key) { return PIN_OVERRIDES.has(key); }

// The element on line `line0` (0-based), given the parse and whatever element
// is pinned there. Pure, so the stress test can drive every element through it
// with a real parse instead of a mocked view.
//
// A pin only wins where it can't be contradicting the file: on a line with no
// text yet, on the two elements the parser genuinely cannot judge from the line
// alone (see PIN_OVERRIDES), or where the parser already agrees. Anywhere else
// the parser wins, so the picker can never report an element the saved file
// does not contain. Letting the pin win unconditionally is what produced the
// "it says Lyric until I type, then flips to Action" class of bug.
export function caretElementFor(doc, parsed, line0, pin) {
  const b = parsed && parsed.blocks.find((x) => x.line === line0);
  // A cue you have only just typed still parses as action, because parse.js
  // cannot call it a cue until a non-blank line follows it. Taken literally
  // that would send Enter to another action line and the cue would never get
  // its dialogue. Read it as the character cue it is about to become: the same
  // rule the decoration layer previews with (isPendingCharacterCue). Requiring
  // nothing but whitespace before the text keeps a forced action ("!JANE")
  // out of it while still allowing an indented cue.
  const says = (b && b.type === 'action' && lineBlank(doc, line0) && isCharacterCueText(b.text)
    && /^\s*$/.test(doc.line(line0 + 1).text.slice(0, b.textOffset)))
    ? 'character'
    : elementOfBlock(b);
  if (!pin) return says;
  if (pin === says) return pin;
  if (doc.line(line0 + 1).text.trim() === '') return pin;
  return pinOverridesParser(pin) ? pin : says;
}

// The element under the caret. `getParsed(view)` returns the shared parse.
function caretElement(view, getParsed, line0) {
  const doc = view.state.doc;
  const active = view.state.field(activeElementField, false);
  let pin = null;
  if (active && doc.lineAt(Math.min(active.pos, doc.length)).number - 1 === line0) pin = active.el;
  return caretElementFor(doc, getParsed(view), line0, pin);
}

function setLine(view, line, key) {
  const sep = elementSeparator(view.state.doc, line, key);
  const { text: next, caret } = applyElementTo(line.text, key);
  const start = line.from + sep.length;
  view.dispatch({
    changes: sep || next !== line.text ? { from: line.from, to: line.to, insert: sep + next } : undefined,
    selection: { anchor: start + caret },
    effects: setActiveElement.of({ el: key, pos: start }),
  });
  return true;
}

// Applies an element to whichever line the caret is on. The one entry point
// for "make this line a <x>": Tab, the panel picker and the element menu all
// come through here, so they cannot drift apart.
export function applyElementAtCaret(view, key) {
  return setLine(view, view.state.doc.lineAt(view.state.selection.main.head), key);
}

// Tab off a written character cue opens a parenthetical on the next line,
// Final Draft style. Contiguous with the cue on purpose: a parenthetical is
// part of the speech, so no blank line here.
function openParenthetical(view, line) {
  const insert = '\n()';
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: line.to + 2 }, // between the brackets
    effects: setActiveElement.of({ el: 'paren', pos: line.to + 1 }),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

// Tab out of a parenthetical drops into the speech either way: if you wrote
// one it stays and the dialogue starts on the next line, if you didn't the
// empty brackets are cleared and that line becomes the dialogue. Nobody wants
// an empty "()" left in the script.
function parentheticalToDialogue(view, line) {
  const written = line.text.trim().replace(/^\(|\)$/g, '').trim() !== '';
  const from = written ? line.to : line.from;
  const insert = written ? '\n' : '';
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length },
    effects: setActiveElement.of({ el: 'dialogue', pos: from + insert.length }),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

// Next element in the Tab cycle. Exported so the cycle can be checked against
// what applyElement actually writes: every step has to round-trip back to an
// empty line, or tabbing past scene heading would leave its "." behind.
export function nextInCycle(cur, dir) {
  let idx = TAB_CYCLE.indexOf(cur);
  if (idx < 0) idx = dir > 0 ? -1 : 0;
  return TAB_CYCLE[(idx + dir + TAB_CYCLE.length) % TAB_CYCLE.length];
}

function cycle(view, getParsed, dir) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const cur = caretElement(view, getParsed, line.number - 1);
  // The cue flow, only once the cue has a name on it: on a still-empty line
  // "character" is just where the cycle happens to be, so Tab goes on cycling.
  if (dir > 0 && cur === 'character' && line.text.trim() !== '') return openParenthetical(view, line);
  if (dir > 0 && cur === 'paren') return parentheticalToDialogue(view, line);
  return setLine(view, line, nextInCycle(cur, dir));
}

// What Enter should insert, which element it lands you in, and where the caret
// ends up. Pure (a Text doc and a range, no view) because the whole bug class
// here is "the file does not mean what the editor was showing", which is worth
// testing without a DOM.
//
// The new line is SEEDED with the next element's markup. Pinning the element
// without writing its markup was the core defect: Enter off a lyric left a
// blank line labelled Lyric, and the words you then typed were action.
export function enterPlan(doc, sel, cur) {
  const line = doc.lineAt(sel.from);
  // The element flow only applies to finishing an element: splitting a line
  // mid-text, or pressing Enter on a line that is already blank, is a plain
  // newline and nothing else.
  const finishing = sel.from === sel.to && sel.from === line.to && line.text.trim() !== '';
  const el = finishing ? (NEXT_ON_ENTER[cur] || 'action') : null;
  const br = el && needsBlankLine(cur, el) ? '\n\n' : '\n';
  const seed = el ? applyElementTo('', el) : { text: '', caret: 0 };
  return { insert: br + seed.text, el, caret: br.length + seed.caret, lineStart: br.length };
}

// What Backspace should do beyond deleting one character, or null to let the
// default handle it. Two cases, both of them "undo what the element flow just
// wrote, in one press":
//
//   1. The line holds nothing but an element's own markup. Deleting one
//      character of "()" or "> <" leaves broken markup that parses as
//      something else entirely, so the whole seed goes.
//   2. Backing off the start of an empty line also takes the blank line that
//      Enter inserted to end the previous block, landing you back at the end
//      of what you were writing instead of in a limbo line the parser cannot
//      attribute to anything.
export function backspacePlan(doc, sel) {
  if (sel.from !== sel.to) return null;
  const line = doc.lineAt(sel.from);
  if (isBareMarkup(line.text)) return { from: line.from, to: line.to, caret: line.from };
  if (line.text === '' && sel.from === line.from && line.number > 2) {
    const prev = doc.line(line.number - 1);
    if (prev.text.trim() === '') {
      const before = doc.line(line.number - 2);
      return { from: before.to, to: line.to, caret: before.to };
    }
  }
  return null;
}

function smartEnter(view, getParsed) {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const cur = caretElement(view, getParsed, line.number - 1);
  // Enter with nothing on the line is a question, not a line break: it asks
  // what you want to write next, so it opens the element menu (Final Draft's
  // behaviour, and the reason the menu exists) with the element you are
  // already in highlighted.
  if (sel.empty && line.text.trim() === '') return openElementMenu(view, line.from, cur);
  const { insert, el, caret, lineStart } = enterPlan(view.state.doc, sel, cur);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + caret },
    effects: setActiveElement.of(el ? { el, pos: sel.from + lineStart } : null),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

function smartBackspace(view) {
  const sel = view.state.selection.main;
  const plan = backspacePlan(view.state.doc, sel);
  if (!plan) return false;
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: '' },
    selection: { anchor: plan.caret },
    effects: setActiveElement.of(null),
    userEvent: 'delete',
    scrollIntoView: true,
  });
  return true;
}

// A line break and nothing else. Enter is spoken for (element flow, and the
// element menu on an empty line), so this is the way to put a plain blank line
// wherever you want one.
function plainNewline(view) {
  view.dispatch({ ...view.state.replaceSelection('\n'), scrollIntoView: true, userEvent: 'input' });
  return true;
}

// Must sit BEFORE the default keymap so Tab/Enter reach here first. Tab is
// captured for element flow (screenplay editors do this); panel-focus
// shortcuts will live elsewhere.
export function elementKeymap({ getParsed }) {
  return keymap.of([
    { key: 'Tab', run: (v) => cycle(v, getParsed, 1), shift: (v) => cycle(v, getParsed, -1) },
    { key: 'Enter', run: (v) => smartEnter(v, getParsed) },
    { key: 'Shift-Enter', run: plainNewline },
    // Falls through to the default when the plan is null, so ordinary
    // character-by-character deletion is untouched.
    { key: 'Backspace', run: smartBackspace },
  ]);
}

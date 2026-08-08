// Locks "start with Summary" (feature 4): the first keystroke into an empty
// script must produce a Fountain synopsis (`= text`), so what the writer types
// is genuinely a Summary and stays one, while normal editing is untouched.
'use strict';

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { parseFountain } from '../../fountain/parse.js';
import { summaryDefault } from './cm-summary-default.js';
import { activeElementField, setActiveElement } from './cm-autoformat.js';

function type(doc, insert, at = doc.length) {
  const state = EditorState.create({ doc, extensions: [summaryDefault] });
  const tr = state.update({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    userEvent: 'input.type',
  });
  return tr.state;
}

// Type into an empty doc that already has `el` pinned to the first line, the way
// the picker / Tab would leave it before the writer starts typing.
function typeWithPin(el, insert) {
  let state = EditorState.create({ doc: '', extensions: [activeElementField, summaryDefault] });
  state = state.update({ effects: setActiveElement.of({ el, pos: 0 }) }).state;
  return state.update({
    changes: { from: 0, insert },
    selection: { anchor: insert.length },
    userEvent: 'input.type',
  }).state;
}

describe('summaryDefault', () => {
  it('turns the first keystroke of an empty script into a synopsis', () => {
    const state = type('', 'A');
    expect(state.doc.toString()).toBe('= A');
    // The result parses as a synopsis, not action -- the file itself agrees.
    expect(parseFountain(state.doc.toString()).blocks[0].type).toBe('synopsis');
  });

  it('leaves the caret after the typed text, past the inserted marker', () => {
    const state = type('', 'A');
    expect(state.selection.main.head).toBe(3); // "= A".length
  });

  it('does not touch input once the document already has text', () => {
    const state = type('Hello', ' world');
    expect(state.doc.toString()).toBe('Hello world');
  });

  it('leaves a pasted multi-line block alone (not a hand-typed summary)', () => {
    const state = type('', 'INT. KITCHEN - DAY\n\nAction here.');
    expect(state.doc.toString()).toBe('INT. KITCHEN - DAY\n\nAction here.');
  });

  it('is only a default: a line pinned to another element types plainly', () => {
    // The writer changed the first element to Action before typing; Summary must
    // not force its marker back on.
    const state = typeWithPin('action', 'Sarah runs.');
    expect(state.doc.toString()).toBe('Sarah runs.');
  });

  it('still defaults to Summary when the pin is synopsis', () => {
    const state = typeWithPin('synopsis', 'The logline.');
    expect(state.doc.toString()).toBe('= The logline.');
  });
});

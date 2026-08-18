// Locks openCounterpartSeq: the drop-on-script path (script-editor.js) uses
// this to decide whether a new board should take an existing counterpart's
// seq (pairing it into that slot) or start a fresh one, with no dependence
// on the order placeholders happen to be filled in.
'use strict';

import { describe, it, expect } from 'vitest';
import { openCounterpartSeq } from './project-model.js';

const parts = [{ q: 'INT. HOUSE - DAY', b: 0, s: 0 }];

describe('openCounterpartSeq', () => {
  it('returns null when the anchor has no boards yet', () => {
    expect(openCounterpartSeq([], parts, true)).toBeNull();
  });

  it('finds the seq of an other-mode board with no counterpart in the target mode', () => {
    const boards = [
      { id: 'f0', anchor: { parts }, seq: 0, ref: false },
      { id: 'f1', anchor: { parts }, seq: 1, ref: false },
      { id: 'r0', anchor: { parts }, seq: 0, ref: true },
    ];
    // Final has seq 1 with no reference counterpart yet.
    expect(openCounterpartSeq(boards, parts, true)).toBe(1);
    // Every final seq already has a same-mode board, or is missing a
    // reference counterpart, not a final one -- nothing open for a new final.
    expect(openCounterpartSeq(boards, parts, false)).toBeNull();
  });

  it('ignores boards at a different anchor', () => {
    const other = [{ q: 'EXT. PARK - NIGHT', b: 5, s: 0 }];
    const boards = [{ id: 'x', anchor: { parts: other }, seq: 0, ref: false }];
    expect(openCounterpartSeq(boards, parts, true)).toBeNull();
  });

  it('picks the lowest open seq when several are available', () => {
    const boards = [
      { id: 'f0', anchor: { parts }, seq: 0, ref: false },
      { id: 'f2', anchor: { parts }, seq: 2, ref: false },
    ];
    expect(openCounterpartSeq(boards, parts, true)).toBe(0);
  });
});

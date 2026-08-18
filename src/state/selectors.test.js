// Locks the final/reference frame-parity contract: boardSlots must pair a
// final and a reference board at the same anchor+seq into one slot, and
// leave same-anchor boards at a different seq as separate slots, so a
// passage boarded three times in one storyboard always has three places in
// the other -- see the boards panel and slideshow, which both read this
// instead of filtering project.boards by ref directly. Also locks coverage()
// excluding reference boards from the boarded percentage (hard rule 3):
// a reference frame is inspiration, not evidence the beat is drawn.
'use strict';

import { describe, it, expect } from 'vitest';
import { boardSlots, slotBoard, coverage } from './selectors.js';

function resolved(id, { parts, seq = 0, ref = false, ok = true, firstBi = 0, sceneIdx = 0 }) {
  return { bd: { id, anchor: { parts }, seq, ref }, ok, firstBi, sceneIdx, res: [] };
}

describe('boardSlots', () => {
  const parts = [{ q: 'INT. HOUSE - DAY', b: 0, s: 0 }];

  it('pairs a final and a reference board sharing an anchor and seq into one slot', () => {
    const f = resolved('f1', { parts, seq: 0, ref: false, firstBi: 2 });
    const r = resolved('r1', { parts, seq: 0, ref: true, firstBi: 2 });
    const slots = boardSlots([f, r]);
    expect(slots.length).toBe(1);
    expect(slots[0].final).toBe(f);
    expect(slots[0].ref).toBe(r);
  });

  it('gives three reference frames at one anchor three slots, even with only one final', () => {
    const f0 = resolved('f0', { parts, seq: 0, ref: false, firstBi: 2 });
    const r0 = resolved('r0', { parts, seq: 0, ref: true, firstBi: 2 });
    const r1 = resolved('r1', { parts, seq: 1, ref: true, firstBi: 2 });
    const r2 = resolved('r2', { parts, seq: 2, ref: true, firstBi: 2 });
    const slots = boardSlots([f0, r0, r1, r2]);
    expect(slots.length).toBe(3);
    expect(slots.map((s) => !!s.final)).toEqual([true, false, false]);
    expect(slots.every((s) => !!s.ref)).toBe(true);
  });

  it('excludes boards that do not resolve', () => {
    const f = resolved('f1', { parts, seq: 0, ref: false, firstBi: 2 });
    const dangling = resolved('d1', { parts, seq: 1, ref: false, ok: false });
    expect(boardSlots([f, dangling]).length).toBe(1);
  });

  it('orders slots by document position, then seq', () => {
    const a = resolved('a', { parts: [{ q: 'A', b: 0, s: 0 }], seq: 0, firstBi: 10, sceneIdx: 1 });
    const b = resolved('b', { parts: [{ q: 'B', b: 0, s: 0 }], seq: 0, firstBi: 2, sceneIdx: 0 });
    expect(boardSlots([a, b]).map((s) => s.firstBi)).toEqual([2, 10]);
  });
});

describe('slotBoard', () => {
  const parts = [{ q: 'INT. HOUSE - DAY', b: 0, s: 0 }];

  it('returns null for the mode that has not filled the slot', () => {
    const f0 = resolved('f0', { parts, seq: 0, ref: false, firstBi: 2 });
    const r1 = resolved('r1', { parts, seq: 1, ref: true, firstBi: 2 });
    const slots = boardSlots([f0, r1]);
    const slot0 = slots.find((s) => s.seq === 0);
    const slot1 = slots.find((s) => s.seq === 1);
    expect(slotBoard(slot0, false)).toBe(f0);
    expect(slotBoard(slot0, true)).toBeNull();
    expect(slotBoard(slot1, false)).toBeNull();
    expect(slotBoard(slot1, true)).toBe(r1);
  });
});

describe('coverage', () => {
  it('counts a final board as boarded and excludes a reference board entirely', () => {
    const scenes = [{ start: 0, content: 2 }, { start: 10, content: 2 }];
    const R = {
      boards: [
        { bd: { ref: false, img: 'data:a' }, ok: true, sceneIdx: 0, res: [{ bi: 1 }] },
        // Reference, with an image, resolving into scene 1: must not count.
        { bd: { ref: true, img: 'data:b' }, ok: true, sceneIdx: 1, res: [{ bi: 11 }] },
        // Final, blank: pending, not boarded.
        { bd: { ref: false, img: null }, ok: true, sceneIdx: 1, res: [{ bi: 12 }] },
      ],
      links: [],
    };
    coverage(scenes, R);
    expect(scenes[0].nb).toBe(1);
    expect(scenes[0].fb).toBe(0.5);
    expect(scenes[1].nb).toBe(0);
    expect(scenes[1].nbPending).toBe(1);
    expect(scenes[1].fb).toBe(0);
  });
});

// Locks the storyboard contract the boards panel, slideshow and timeline all
// read: every linked storyboard is ONE entry carrying both a final and a
// reference frame, so the two views list exactly the same beats
// (linkedBoards). Also locks coverage() (hard rule 3): a storyboard only
// counts as boarded when its FINAL frame has an image; a blank one, or one
// holding only a reference frame, is pending, never boarded.
'use strict';

import { describe, it, expect } from 'vitest';
import { linkedBoards, coverage, boardLinkKinds, describeSlideshowGap } from './selectors.js';

function resolved(id, { parts, seq = 0, img = null, refImg = null, ok = true, firstBi = 0, sceneIdx = 0 }) {
  return { bd: { id, anchor: { parts }, seq, img, refImg }, ok, firstBi, sceneIdx, res: [] };
}

describe('linkedBoards', () => {
  const parts = [{ q: 'INT. HOUSE - DAY', b: 0, s: 0 }];

  it('lists one entry per storyboard, however many frames it has filled', () => {
    const both = resolved('both', { parts, seq: 0, img: 'F', refImg: 'R', firstBi: 2 });
    const finalOnly = resolved('fo', { parts, seq: 1, img: 'F', firstBi: 2 });
    const refOnly = resolved('ro', { parts, seq: 2, refImg: 'R', firstBi: 2 });
    const blank = resolved('bl', { parts, seq: 3, firstBi: 2 });
    expect(linkedBoards([both, finalOnly, refOnly, blank]).map((o) => o.bd.id)).toEqual(['both', 'fo', 'ro', 'bl']);
  });

  it('excludes storyboards that do not resolve', () => {
    const f = resolved('f1', { parts, seq: 0, img: 'F', firstBi: 2 });
    const dangling = resolved('d1', { parts, seq: 1, ok: false });
    expect(linkedBoards([f, dangling]).map((o) => o.bd.id)).toEqual(['f1']);
  });

  it('orders by document position, then seq', () => {
    const a = resolved('a', { parts: [{ q: 'A', b: 0, s: 0 }], seq: 0, firstBi: 10, sceneIdx: 1 });
    const b = resolved('b', { parts: [{ q: 'B', b: 0, s: 0 }], seq: 0, firstBi: 2, sceneIdx: 0 });
    const c = resolved('c', { parts, seq: 1, firstBi: 2 });
    const d = resolved('d', { parts, seq: 0, firstBi: 2 });
    // b and d share position and seq, so input order (b before d) breaks the tie.
    expect(linkedBoards([a, b, c, d]).map((o) => o.bd.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('coverage', () => {
  it('counts only a FINAL image as boarded; blank and reference-only storyboards are pending', () => {
    const scenes = [{ start: 0, content: 2 }, { start: 10, content: 2 }];
    const R = {
      boards: [
        { bd: { img: 'data:a', refImg: null }, ok: true, sceneIdx: 0, res: [{ bi: 1 }] },
        // Only a reference frame, resolving into scene 1: claimed, not drawn.
        { bd: { img: null, refImg: 'data:b' }, ok: true, sceneIdx: 1, res: [{ bi: 11 }] },
        // Blank: pending too.
        { bd: { img: null, refImg: null }, ok: true, sceneIdx: 1, res: [{ bi: 12 }] },
      ],
      links: [],
    };
    coverage(scenes, R);
    expect(scenes[0].nb).toBe(1);
    expect(scenes[0].fb).toBe(0.5);
    expect(scenes[1].nb).toBe(0);
    expect(scenes[1].nbPending).toBe(2);
    expect(scenes[1].fb).toBe(0);
  });

  it('does not let a reference frame inflate a storyboard that has a final one', () => {
    const scenes = [{ start: 0, content: 4 }];
    const R = {
      boards: [{ bd: { img: 'F', refImg: 'R' }, ok: true, sceneIdx: 0, res: [{ bi: 1 }] }],
      links: [],
    };
    coverage(scenes, R);
    expect(scenes[0].nb).toBe(1);
    expect(scenes[0].bset.size).toBe(1);
  });
});

describe('boardLinkKinds', () => {
  const mk = (id, img, refImg, bis, ok = true) => ({ bd: { id, img, refImg }, ok, res: bis.map((bi) => (bi == null ? null : { bi, s: 0, e: 1 })) });

  it('reads a storyboard as reference only when its sole image is the reference one', () => {
    const kinds = boardLinkKinds([mk('f', 'F', null, [1]), mk('r', null, 'R', [2]), mk('lost', 'F', null, [3], false)]);
    expect(kinds.get(1)).toEqual({ final: true, ref: false });
    expect(kinds.get(2)).toEqual({ final: false, ref: true });
    expect(kinds.has(3)).toBe(false);
  });

  it('reads a storyboard with both frames, or with none, as final', () => {
    const kinds = boardLinkKinds([mk('both', 'F', 'R', [4]), mk('blank', null, null, [5])]);
    expect(kinds.get(4)).toEqual({ final: true, ref: false });
    expect(kinds.get(5)).toEqual({ final: true, ref: false });
  });

  it('reports both where a block is covered by a final and a reference-only storyboard', () => {
    const kinds = boardLinkKinds([mk('f', 'F', null, [6]), mk('r', null, 'R', [6])]);
    expect(kinds.get(6)).toEqual({ final: true, ref: true });
  });

  it('ignores unresolved parts of an otherwise resolved storyboard', () => {
    const kinds = boardLinkKinds([mk('f', 'F', null, [null, 7])]);
    expect([...kinds.keys()]).toEqual([7]);
  });
});

describe('describeSlideshowGap', () => {
  const blocks = (plain) => ({ blocks: plain ? [{ line: 0, plain }] : [] });
  const board = (img, refImg, ok) => ({ bd: { img, refImg }, ok });

  it('asks for script first, then frames, then links, then lets it proceed', () => {
    expect(describeSlideshowGap(blocks(''), [], 'final', 'record pacing')).toMatch(/Write some script/);
    expect(describeSlideshowGap(blocks('hi'), [], 'final', 'record pacing')).toMatch(/Add storyboard frames/);
    expect(describeSlideshowGap(blocks('hi'), [board('x', null, false)], 'final', 'record pacing')).toMatch(/Link your storyboard frames/);
    expect(describeSlideshowGap(blocks('hi'), [board('x', null, true)], 'final', 'record pacing')).toBeNull();
  });

  it('checks the frame of the mode being played, not the other one', () => {
    expect(describeSlideshowGap(blocks('hi'), [board('x', null, true)], 'reference', 'preview the show')).toMatch(/Add reference frames/);
    expect(describeSlideshowGap(blocks('hi'), [board(null, 'x', true)], 'reference', 'preview the show')).toBeNull();
    expect(describeSlideshowGap(blocks('hi'), [board(null, 'x', true)], 'final', 'preview the show')).toMatch(/Add storyboard frames/);
  });

  it('does not count a blank storyboard as a frame', () => {
    expect(describeSlideshowGap(blocks('hi'), [board(null, null, true)], 'final', 'preview the show')).toMatch(/Add storyboard frames/);
  });
});

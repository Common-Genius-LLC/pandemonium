// Locks the storyboard model: one board = one script passage with a final frame
// (`img`) and a reference frame (`refImg`), so making one from either side
// always makes the other, empty, and both modes show the same passage. Also
// locks migrateBoards, which has to open every project saved before frames
// were paired (one board per frame, matched only by anchor + seq) without
// losing an image, and be safe to run again on data that is already migrated.
'use strict';

import { describe, it, expect } from 'vitest';
import {
  addBoard, addBlankBoard, placeFrame, replaceBoardImage, swapBoardFrames, setBoardNote,
  frameImg, otherMode, migrateBoards, reattachBoard, deleteBoard,
} from './project-model.js';

const parts = [{ q: 'INT. HOUSE - DAY', b: 0, s: 0 }];
const other = [{ q: 'She waits.', b: 1, s: 0 }];
const empty = () => ({ boards: [] });

describe('frameImg / otherMode', () => {
  it('reads the frame for a mode and treats a missing one as null', () => {
    const bd = { img: 'F', refImg: null };
    expect(frameImg(bd, 'final')).toBe('F');
    expect(frameImg(bd, 'reference')).toBeNull();
    expect(frameImg({}, 'reference')).toBeNull();
    expect(frameImg(null, 'final')).toBeNull();
  });
  it('flips the mode', () => {
    expect(otherMode('final')).toBe('reference');
    expect(otherMode('reference')).toBe('final');
  });
});

describe('addBoard', () => {
  it('puts the image in the chosen frame and leaves the other empty', () => {
    const f = addBoard(empty(), { parts, img: 'A', mode: 'final' }).board;
    expect([f.img, f.refImg]).toEqual(['A', null]);
    const r = addBoard(empty(), { parts, img: 'B', mode: 'reference' }).board;
    expect([r.img, r.refImg]).toEqual([null, 'B']);
  });
  it('defaults to the final frame', () => {
    expect(addBoard(empty(), { parts, img: 'A' }).board.img).toBe('A');
  });
  it('has no `ref` flag and starts with an empty note', () => {
    const b = addBoard(empty(), { parts, img: 'A' }).board;
    expect('ref' in b).toBe(false);
    expect(b.note).toBe('');
  });
  it('gives each board on one passage its own seq', () => {
    let p = empty();
    p = addBoard(p, { parts, img: 'A' }).project;
    const second = addBoard(p, { parts, img: 'B' }).board;
    expect(second.seq).toBe(1);
  });
});

describe('addBlankBoard', () => {
  it('makes a storyboard with both frames empty and an optional note', () => {
    const b = addBlankBoard(empty(), { parts, note: 'wide, dolly in' }).board;
    expect([b.img, b.refImg, b.note]).toEqual([null, null, 'wide, dolly in']);
  });
});

describe('placeFrame', () => {
  it('fills the empty frame of a storyboard already on the passage instead of adding a second', () => {
    const p1 = addBoard(empty(), { parts, img: 'FINAL', mode: 'final' }).project;
    const { project, board } = placeFrame(p1, { parts, img: 'REF', mode: 'reference' });
    expect(project.boards).toHaveLength(1);
    expect([board.img, board.refImg]).toEqual(['FINAL', 'REF']);
  });
  it('fills a blank storyboard rather than starting another beside it', () => {
    const p1 = addBlankBoard(empty(), { parts }).project;
    const { project } = placeFrame(p1, { parts, img: 'A', mode: 'final' });
    expect(project.boards).toHaveLength(1);
    expect(project.boards[0].img).toBe('A');
  });
  it('starts a new storyboard when that frame is already filled everywhere on the passage', () => {
    const p1 = addBoard(empty(), { parts, img: 'A', mode: 'final' }).project;
    const { project } = placeFrame(p1, { parts, img: 'B', mode: 'final' });
    expect(project.boards).toHaveLength(2);
    expect(project.boards.map((b) => b.img)).toEqual(['A', 'B']);
  });
  it('fills the lowest-seq open frame first', () => {
    let p = addBoard(empty(), { parts, img: 'A', mode: 'final' }).project;
    p = addBoard(p, { parts, img: 'B', mode: 'final' }).project;
    const { project } = placeFrame(p, { parts, img: 'R', mode: 'reference' });
    expect(project.boards.map((b) => b.refImg)).toEqual(['R', null]);
  });
  it('ignores a storyboard on a different passage', () => {
    const p1 = addBoard(empty(), { parts: other, img: 'A', mode: 'final' }).project;
    expect(placeFrame(p1, { parts, img: 'R', mode: 'reference' }).project.boards).toHaveLength(2);
  });
  it('never pairs unlinked images with each other', () => {
    const p1 = addBoard(empty(), { parts: [], img: 'A', mode: 'final' }).project;
    expect(placeFrame(p1, { parts: [], img: 'R', mode: 'reference' }).project.boards).toHaveLength(2);
  });
});

describe('frame edits', () => {
  const one = () => addBoard(empty(), { parts, img: 'F', mode: 'final' });

  it('replaceBoardImage sets one frame and leaves the other alone', () => {
    const { project, board } = one();
    const p = replaceBoardImage(project, board.id, 'R', 'reference');
    expect([p.boards[0].img, p.boards[0].refImg]).toEqual(['F', 'R']);
    const cleared = replaceBoardImage(p, board.id, null, 'final');
    expect([cleared.boards[0].img, cleared.boards[0].refImg]).toEqual([null, 'R']);
  });
  it('swapBoardFrames swaps two images', () => {
    const { project, board } = one();
    const p = swapBoardFrames(replaceBoardImage(project, board.id, 'R', 'reference'), board.id);
    expect([p.boards[0].img, p.boards[0].refImg]).toEqual(['R', 'F']);
  });
  it('swapBoardFrames with one side empty is a move that leaves the passage attached', () => {
    const { project, board } = one();
    const p = swapBoardFrames(project, board.id);
    expect([p.boards[0].img, p.boards[0].refImg]).toEqual([null, 'F']);
    expect(p.boards[0].anchor.parts).toEqual(parts);
  });
  it('setBoardNote stores a note on the storyboard only', () => {
    const { project, board } = one();
    const p = setBoardNote(project, board.id, 'hold on her hands');
    expect(p.boards[0].note).toBe('hold on her hands');
    expect(p.comments).toBeUndefined();
  });
  it('unlinking or deleting acts on the whole storyboard, both frames', () => {
    const { project, board } = one();
    const both = replaceBoardImage(project, board.id, 'R', 'reference');
    const unlinked = reattachBoard(both, board.id, []);
    expect([unlinked.boards[0].img, unlinked.boards[0].refImg]).toEqual(['F', 'R']);
    expect(deleteBoard(both, board.id).boards).toHaveLength(0);
  });
});

describe('migrateBoards', () => {
  const legacy = (over) => ({ id: 'x', anchor: { parts }, img: null, caption: '', seq: 0, ref: false, ...over });

  it('folds a final board and a reference board on the same passage and seq into one storyboard', () => {
    const p = migrateBoards({ boards: [legacy({ id: 'f', img: 'F' }), legacy({ id: 'r', img: 'R', ref: true })] });
    expect(p.boards).toHaveLength(1);
    expect(p.boards[0]).toMatchObject({ id: 'f', img: 'F', refImg: 'R' });
    expect('ref' in p.boards[0]).toBe(false);
  });
  it('keeps a lone final board and gives it an empty reference frame', () => {
    const p = migrateBoards({ boards: [legacy({ id: 'f', img: 'F' })] });
    expect(p.boards[0]).toMatchObject({ id: 'f', img: 'F', refImg: null, note: '' });
  });
  it('turns a lone reference board into a storyboard with an empty final frame, keeping its id', () => {
    const p = migrateBoards({ boards: [legacy({ id: 'r', img: 'R', ref: true })] });
    expect(p.boards[0]).toMatchObject({ id: 'r', img: null, refImg: 'R' });
  });
  it('pairs by seq, so a passage boarded three times keeps three storyboards', () => {
    const p = migrateBoards({
      boards: [
        legacy({ id: 'f0', img: 'F0', seq: 0 }), legacy({ id: 'f1', img: 'F1', seq: 1 }),
        legacy({ id: 'r0', img: 'R0', ref: true, seq: 0 }), legacy({ id: 'r1', img: 'R1', ref: true, seq: 1 }),
        legacy({ id: 'r2', img: 'R2', ref: true, seq: 2 }),
      ],
    });
    expect(p.boards.map((b) => [b.id, b.img, b.refImg])).toEqual([
      ['f0', 'F0', 'R0'], ['f1', 'F1', 'R1'], ['r2', null, 'R2'],
    ]);
  });
  it('does not pair boards on different passages', () => {
    const p = migrateBoards({
      boards: [legacy({ id: 'f', img: 'F' }), legacy({ id: 'r', img: 'R', ref: true, anchor: { parts: other } })],
    });
    expect(p.boards).toHaveLength(2);
  });
  it('never pairs unlinked boards with each other', () => {
    const p = migrateBoards({
      boards: [legacy({ id: 'f', img: 'F', anchor: { parts: [] } }), legacy({ id: 'r', img: 'R', ref: true, anchor: { parts: [] } })],
    });
    expect(p.boards).toHaveLength(2);
  });
  it('keeps the caption and recorded pacing from whichever side had them', () => {
    const p = migrateBoards({
      boards: [legacy({ id: 'f', img: 'F' }), legacy({ id: 'r', img: 'R', ref: true, caption: 'cap', dur: 4.2 })],
    });
    expect(p.boards[0]).toMatchObject({ caption: 'cap', dur: 4.2 });
  });
  it('loses no image: every input image lands in exactly one frame', () => {
    const input = [
      legacy({ id: 'a', img: 'A' }), legacy({ id: 'b', img: 'B', ref: true }),
      legacy({ id: 'c', img: 'C', seq: 1 }), legacy({ id: 'd', img: 'D', ref: true, seq: 5 }),
      legacy({ id: 'e', img: null, ref: true, seq: 2 }),
    ];
    const out = migrateBoards({ boards: input }).boards;
    const images = out.flatMap((b) => [b.img, b.refImg]).filter(Boolean).sort();
    expect(images).toEqual(['A', 'B', 'C', 'D']);
  });
  it('is idempotent and returns the same object once migrated', () => {
    const once = migrateBoards({ boards: [legacy({ id: 'f', img: 'F' }), legacy({ id: 'r', img: 'R', ref: true })] });
    expect(migrateBoards(once)).toBe(once);
  });
  it('leaves a project with no boards untouched', () => {
    const p = { boards: [] };
    expect(migrateBoards(p)).toBe(p);
  });
  it('treats a board from before the reference feature (no ref key at all) as a final board', () => {
    const p = migrateBoards({ boards: [{ id: 'old', anchor: { parts }, img: 'F', caption: '', seq: 0 }] });
    expect(p.boards[0]).toMatchObject({ id: 'old', img: 'F', refImg: null });
  });
});

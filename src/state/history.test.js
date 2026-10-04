// Locks the one rule that makes per-panel undo mean anything: a change goes on
// the thread of the DATA it touched, every thread steps independently, and
// stepping back is never itself a step. Driven through the real store, because
// what matters is that the store's own mutations land on the right threads.
'use strict';

import { describe, it, expect, beforeEach } from 'vitest';
import { PandemoniumStore } from './store.js';
import { changedScopes, snapshotOf, applySnapshot, scopeForPanel, PanelHistory } from './history.js';

function store() {
  const s = new PandemoniumStore();
  s.loadProject({ name: 'P', scripts: [{ id: 's1', name: 'Final Draft', text: 'INT. ROOM - DAY\n\nShe waits.\n', final: true }] });
  return s;
}

const parts = [{ q: 'She waits.', b: 2, s: 0 }];

describe('which thread a change belongs on', () => {
  it('is decided by the branches it touched, not by where it was made', () => {
    const before = { boards: [], research: [], folders: [], links: [], sounds: [], tracks: [], clips: [] };
    expect(changedScopes(before, { ...before, boards: [{ id: 'b' }] })).toEqual(['boards']);
    expect(changedScopes(before, { ...before, clips: [{ id: 'c' }] })).toEqual(['sound']);
    expect(changedScopes(before, { ...before, links: [{ id: 'l' }] })).toEqual(['research']);
    expect(changedScopes(before, before)).toEqual([]);
  });
  it('can be two threads at once when a change touched both', () => {
    const before = { boards: [], research: [], folders: [], links: [], sounds: [], tracks: [], clips: [] };
    const after = { ...before, boards: [{ id: 'b' }], clips: [{ id: 'c' }] };
    expect(changedScopes(before, after).sort()).toEqual(['boards', 'sound']);
  });
  it('sends a script pane nowhere: its undo is the editor own history', () => {
    expect(scopeForPanel('script')).toBe(null);
    expect(scopeForPanel('status')).toBe(null);
    expect(scopeForPanel('timeline')).toBe('boards');
    expect(scopeForPanel('sound')).toBe('sound');
    expect(scopeForPanel(null)).toBe(null);
  });
});

describe('a snapshot', () => {
  it('holds the branch references as they stand, not copies', () => {
    const boards = [{ id: 'b' }];
    const project = { boards, research: [], folders: [], links: [] };
    const snap = snapshotOf(project, 'boards');
    expect(snap.boards).toBe(boards);
    expect(applySnapshot({ ...project, boards: [] }, snap).boards).toBe(boards);
  });
});

describe('stepping a thread', () => {
  let s;
  beforeEach(() => { s = store(); });

  it('undoes and redoes one panel worth of work', () => {
    const board = s.addBoard({ parts, img: 'data:image/png;base64,x' });
    expect(s.project.boards).toHaveLength(1);
    expect(s.undoPanel('boards')).toBe('Storyboards');
    expect(s.project.boards).toHaveLength(0);
    expect(s.redoPanel('boards')).toBe('Storyboards');
    expect(s.project.boards[0].id).toBe(board.id);
  });

  it('says nothing happened when a thread is empty', () => {
    expect(s.undoPanel('sound')).toBe(null);
    expect(s.canUndoPanel('sound')).toBe(false);
  });

  it('keeps the threads apart: undoing sound leaves the storyboards alone', () => {
    s.addBoard({ parts, img: 'data:image/png;base64,x' });
    const track = s.addTrack({});
    const sound = s.addSound({ name: 'rain.wav', data: 'data:audio/wav;base64,AA', dur: 10 });
    s.addClip({ trackId: track.id, soundId: sound.id, at: 0, dur: 4, spans: [] });
    expect(s.project.clips).toHaveLength(1);
    s.undoPanel('sound'); // the clip
    expect(s.project.clips).toHaveLength(0);
    expect(s.project.boards).toHaveLength(1);
    expect(s.canUndoPanel('boards')).toBe(true);
  });

  it('is not itself a step: an undo cannot be undone, only redone', () => {
    s.addBoard({ parts, img: 'data:image/png;base64,x' });
    s.undoPanel('boards');
    expect(s.canUndoPanel('boards')).toBe(false);
    expect(s.canRedoPanel('boards')).toBe(true);
  });

  it('drops the redo once new work is done on that thread', () => {
    s.addBoard({ parts, img: 'data:image/png;base64,x' });
    s.undoPanel('boards');
    expect(s.canRedoPanel('boards')).toBe(true);
    s.addBoard({ parts, img: 'data:image/png;base64,y' });
    expect(s.canRedoPanel('boards')).toBe(false);
  });

  it('steps back through several changes in order', () => {
    const track = s.addTrack({});
    s.updateTrack(track.id, { name: 'Music' });
    s.updateTrack(track.id, { mute: true });
    s.undoPanel('sound');
    expect(s.project.tracks[0].mute).toBe(false);
    expect(s.project.tracks[0].name).toBe('Music');
    s.undoPanel('sound');
    expect(s.project.tracks[0].name).not.toBe('Music');
    s.undoPanel('sound');
    expect(s.project.tracks).toHaveLength(0);
  });

  it('does not record the script typing that re-derives anchors', () => {
    s.addBoard({ parts, img: 'data:image/png;base64,x' });
    const boards = s.project.boards;
    // What the editor calls on every keystroke, carrying remapped anchors.
    s.applyLiveEdit('s1', 'INT. ROOM - DAY\n\nShe waits a while.\n', boards, s.project.links, s.project.comments);
    // One entry still, the board itself: typing is the editor own history.
    s.undoPanel('boards');
    expect(s.project.boards).toHaveLength(0);
    expect(s.canUndoPanel('boards')).toBe(false);
  });

  it('forgets everything when another project is opened', () => {
    s.addBoard({ parts, img: 'data:image/png;base64,x' });
    expect(s.canUndoPanel('boards')).toBe(true);
    s.loadProject({ name: 'Other', scripts: [{ id: 'x', name: 'Final Draft', text: '', final: true }] });
    expect(s.canUndoPanel('boards')).toBe(false);
  });
});

describe('the stack itself', () => {
  it('holds a bounded number of entries, dropping the oldest', () => {
    const h = new PanelHistory(2);
    const p0 = { boards: [] };
    const p1 = { boards: [1] };
    const p2 = { boards: [1, 2] };
    const p3 = { boards: [1, 2, 3] };
    h.record(p0, p1);
    h.record(p1, p2);
    h.record(p2, p3);
    expect(h.undo('boards', p3).boards).toEqual([1, 2]);
    expect(h.undo('boards', p2).boards).toEqual([1]);
    expect(h.canUndo('boards')).toBe(false);
  });
});

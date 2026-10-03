// Locks the sound arrangement: a clip belongs to the storyboard it starts on
// and moves with it, cutting one never copies audio, trimming can never point
// outside the file, and what the engine is told to play is worked out here and
// not in the panel.
'use strict';

import { describe, it, expect } from 'vitest';
import {
  addSound, updateSound, deleteSound, addTrack, updateTrack, deleteTrack, orderedTracks, moveTrack,
  addClip, updateClip, deleteClip, moveClip, splitClip, trimClip,
  clipStart, clipEnd, anchorAt, trackClips, soundLength, playPlan, snapTime, fmtClock, MIN_CLIP,
} from './audio-model.js';

const empty = () => ({ sounds: [], tracks: [], clips: [] });

// Three storyboards, 10 seconds each, as boardSpans would hand them over.
const SPANS = [
  { boardId: 'b1', start: 0, dur: 10, paced: true },
  { boardId: 'b2', start: 10, dur: 10, paced: true },
  { boardId: 'b3', start: 20, dur: 10, paced: true },
];

function build() {
  let p = empty();
  const s = addSound(p, { name: 'rain.wav', mime: 'audio/wav', data: 'data:audio/wav;base64,AA', dur: 30 }); p = s.project;
  const t = addTrack(p, {}); p = t.project;
  const c = addClip(p, { trackId: t.track.id, soundId: s.sound.id, at: 12, inPoint: 0, dur: 8, spans: SPANS }); p = c.project;
  return { p, sound: s.sound, track: t.track, clip: c.clip };
}

describe('sounds', () => {
  it('holds the file once, with what the browser measured', () => {
    const { sound } = build();
    expect(sound.dur).toBe(30);
    expect(sound.name).toBe('rain.wav');
  });
  it('reports an unknown length as 0 rather than guessing one', () => {
    const { sound } = addSound(empty(), { name: 'x.mp3' });
    expect(sound.dur).toBe(0);
  });
  it('takes the length once the browser has decoded it', () => {
    const made = addSound(empty(), { name: 'x.mp3' });
    const p = updateSound(made.project, made.sound.id, { dur: 4.5 });
    expect(p.sounds[0].dur).toBe(4.5);
  });
  it('takes its clips with it when deleted: a clip with no sound is a silent block', () => {
    const { p, sound } = build();
    const next = deleteSound(p, sound.id);
    expect(next.sounds).toHaveLength(0);
    expect(next.clips).toHaveLength(0);
  });
});

describe('tracks', () => {
  it('names them in the order a mix is built', () => {
    let p = empty();
    const a = addTrack(p, {}); p = a.project;
    const b = addTrack(p, {}); p = b.project;
    expect([a.track.name, b.track.name]).toEqual(['Dialogue', 'Music']);
  });
  it('stacks by seq, not by array order', () => {
    let p = empty();
    const a = addTrack(p, {}); p = a.project;
    const b = addTrack(p, {}); p = b.project;
    p = { ...p, tracks: [p.tracks[1], p.tracks[0]] };
    expect(orderedTracks(p).map((t) => t.id)).toEqual([a.track.id, b.track.id]);
  });
  it('moves one up or down by swapping with its neighbour', () => {
    let p = empty();
    const a = addTrack(p, {}); p = a.project;
    const b = addTrack(p, {}); p = b.project;
    p = moveTrack(p, b.track.id, -1);
    expect(orderedTracks(p).map((t) => t.id)).toEqual([b.track.id, a.track.id]);
    // And refuses to move the top one up.
    expect(orderedTracks(moveTrack(p, b.track.id, -1)).map((t) => t.id)).toEqual([b.track.id, a.track.id]);
  });
  it('mutes without touching its clips', () => {
    const { p, track } = build();
    const next = updateTrack(p, track.id, { mute: true });
    expect(next.tracks[0].mute).toBe(true);
    expect(next.clips).toHaveLength(1);
  });
  it('takes its clips with it when deleted', () => {
    const { p, track } = build();
    expect(deleteTrack(p, track.id).clips).toHaveLength(0);
  });
});

describe('a clip is anchored to a storyboard', () => {
  it('is stored as "this far into that board", not as an absolute time', () => {
    const { clip } = build();
    expect(clip.boardId).toBe('b2');
    expect(clip.offset).toBe(2);
    expect(clipStart(clip, SPANS)).toBe(12);
    expect(clipEnd(clip, SPANS)).toBe(20);
  });
  it('moves with its board when the board is paced longer', () => {
    const { clip } = build();
    const paced = [SPANS[0], { boardId: 'b2', start: 25, dur: 10, paced: true }, { boardId: 'b3', start: 35, dur: 10 }];
    expect(clipStart(clip, paced)).toBe(27);
  });
  it('stays absolute before the first board, and with no boards at all', () => {
    expect(anchorAt(SPANS, 0)).toEqual({ boardId: 'b1', offset: 0 });
    expect(anchorAt([], 7)).toEqual({ boardId: null, offset: 7 });
    expect(clipStart({ boardId: null, offset: 7, dur: 1 }, SPANS)).toBe(7);
  });
  it('falls back to its offset when its board has been deleted, rather than vanishing', () => {
    const clip = { boardId: 'gone', offset: 12, dur: 8 };
    expect(clipStart(clip, SPANS)).toBe(12);
  });
  it('lands in the last board before it when it sits past the end', () => {
    expect(anchorAt(SPANS, 44)).toEqual({ boardId: 'b3', offset: 24 });
  });
});

describe('placing a clip', () => {
  it('never points outside its sound', () => {
    const { p, sound, track } = build();
    const long = addClip(p, { trackId: track.id, soundId: sound.id, at: 0, inPoint: 28, dur: 10, spans: SPANS });
    expect(long.clip.in).toBe(28);
    expect(long.clip.dur).toBe(2);
  });
  it('takes the whole sound when no length is asked for', () => {
    const { p, sound, track } = build();
    const whole = addClip(p, { trackId: track.id, soundId: sound.id, at: 0, spans: SPANS });
    expect(whole.clip.dur).toBe(30);
  });
  it('keeps what it was asked for while the sound is still being decoded', () => {
    let p = empty();
    const s = addSound(p, { name: 'x.mp3' }); p = s.project;
    const t = addTrack(p, {}); p = t.project;
    const c = addClip(p, { trackId: t.track.id, soundId: s.sound.id, at: 0, dur: 3, spans: SPANS });
    expect(c.clip.dur).toBe(3);
  });
});

describe('rearranging', () => {
  it('re-anchors to the board it is dragged onto', () => {
    const { p, clip } = build();
    const next = moveClip(p, clip.id, { at: 23, spans: SPANS });
    expect(next.clips[0].boardId).toBe('b3');
    expect(next.clips[0].offset).toBe(3);
  });
  it('moves between tracks without moving in time', () => {
    const { p, clip, track } = build();
    const t2 = addTrack(p, {});
    const next = moveClip(t2.project, clip.id, { trackId: t2.track.id, spans: SPANS });
    expect(next.clips[0].trackId).toBe(t2.track.id);
    expect(next.clips[0].trackId).not.toBe(track.id);
    expect(clipStart(next.clips[0], SPANS)).toBe(12);
  });
  it('is read back in the order it is heard', () => {
    const { p, sound, track } = build();
    const second = addClip(p, { trackId: track.id, soundId: sound.id, at: 4, dur: 2, spans: SPANS });
    expect(trackClips(second.project, track.id, SPANS).map((o) => o.start)).toEqual([4, 12]);
  });
});

describe('cutting', () => {
  it('splits at a time on the timeline and shares the one sound', () => {
    const { p, clip, sound } = build();
    const out = splitClip(p, clip.id, 15, SPANS);
    const [left, right] = out.project.clips;
    expect(out.project.sounds).toHaveLength(1);
    expect(left.id).toBe(clip.id);
    expect(left.dur).toBe(3);
    expect(left.in).toBe(0);
    expect(right.soundId).toBe(sound.id);
    expect(right.in).toBe(3);
    expect(right.dur).toBe(5);
    expect(clipStart(right, SPANS)).toBe(15);
  });
  it('re-anchors the right half to the board the cut falls in', () => {
    const { p, sound, track } = build();
    const wide = addClip(p, { trackId: track.id, soundId: sound.id, at: 5, dur: 20, spans: SPANS });
    const out = splitClip(wide.project, wide.clip.id, 22, SPANS);
    const right = out.project.clips[out.project.clips.length - 1];
    expect(right.boardId).toBe('b3');
    expect(right.offset).toBe(2);
  });
  it('refuses a cut at either end, which would leave an inaudible sliver', () => {
    const { p, clip } = build();
    expect(splitClip(p, clip.id, 12, SPANS).clip).toBe(null);
    expect(splitClip(p, clip.id, 20, SPANS).clip).toBe(null);
    expect(splitClip(p, clip.id, 12 + MIN_CLIP / 2, SPANS).clip).toBe(null);
    expect(splitClip(p, clip.id, 99, SPANS).clip).toBe(null);
  });
});

describe('trimming', () => {
  it('moves the head in the sound and on the timeline together, so the audio does not slide', () => {
    const { p, clip } = build();
    const next = trimClip(p, clip.id, { head: 2, spans: SPANS });
    const c = next.clips[0];
    expect(c.in).toBe(2);
    expect(c.dur).toBe(6);
    expect(clipStart(c, SPANS)).toBe(14);
  });
  it('never pulls the head before the start of the sound', () => {
    const { p, clip } = build();
    const c = trimClip(p, clip.id, { head: -5, spans: SPANS }).clips[0];
    expect(c.in).toBe(0);
    expect(c.dur).toBe(8);
  });
  it('never runs the tail past the end of the sound', () => {
    const { p, clip } = build();
    const c = trimClip(p, clip.id, { tail: 40, spans: SPANS }).clips[0];
    expect(c.dur).toBe(30);
  });
  it('keeps something audible at either edge', () => {
    const { p, clip } = build();
    expect(trimClip(p, clip.id, { head: 99, spans: SPANS }).clips[0].dur).toBe(MIN_CLIP);
    expect(trimClip(p, clip.id, { tail: -99, spans: SPANS }).clips[0].dur).toBe(MIN_CLIP);
  });
});

describe('what gets played', () => {
  it('is plain numbers, with the playhead inside a clip handled', () => {
    const { p } = build();
    expect(playPlan(p, SPANS, 0)).toEqual([expect.objectContaining({ when: 12, offset: 0, dur: 8 })]);
    expect(playPlan(p, SPANS, 14)).toEqual([expect.objectContaining({ when: 0, offset: 2, dur: 6 })]);
    expect(playPlan(p, SPANS, 20)).toEqual([]);
  });
  it('leaves out a muted track', () => {
    const { p, track } = build();
    expect(playPlan(updateTrack(p, track.id, { mute: true }), SPANS, 0)).toEqual([]);
  });
  it('multiplies a clip gain by its track gain', () => {
    const { p, track, clip } = build();
    let next = updateTrack(p, track.id, { gain: 0.5 });
    next = updateClip(next, clip.id, { gain: 0.5 });
    expect(playPlan(next, SPANS, 0)[0].gain).toBe(0.25);
  });
  it('leaves out a clip whose sound has gone', () => {
    const { p, sound } = build();
    const orphaned = { ...p, sounds: p.sounds.filter((s) => s.id !== sound.id) };
    expect(playPlan(orphaned, SPANS, 0)).toEqual([]);
  });
  it('plays several tracks at once, earliest first', () => {
    const { p, sound, track } = build();
    const t2 = addTrack(p, {});
    const c2 = addClip(t2.project, { trackId: t2.track.id, soundId: sound.id, at: 2, dur: 4, spans: SPANS });
    expect(playPlan(c2.project, SPANS, 0).map((x) => x.when)).toEqual([2, 12]);
    expect(trackClips(c2.project, track.id, SPANS)).toHaveLength(1);
  });
});

// An audio file is the biggest thing a project carries, so one with no clip
// left pointing at it is dropped rather than saved and synced forever.
describe('a sound with no clips left', () => {
  it('goes when its last clip is deleted', () => {
    const { p, clip } = build();
    const next = deleteClip(p, clip.id);
    expect(next.clips).toHaveLength(0);
    expect(next.sounds).toHaveLength(0);
  });
  it('stays while any clip still points at it', () => {
    const { p, clip, sound, track } = build();
    const two = addClip(p, { trackId: track.id, soundId: sound.id, at: 2, dur: 2, spans: SPANS });
    const next = deleteClip(two.project, clip.id);
    expect(next.clips).toHaveLength(1);
    expect(next.sounds).toHaveLength(1);
  });
  it('goes with the track that held its only clip', () => {
    const { p, track } = build();
    expect(deleteTrack(p, track.id).sounds).toHaveLength(0);
  });
  it('survives a cut, which leaves two clips over one file', () => {
    const { p, clip } = build();
    const cut = splitClip(p, clip.id, 15, SPANS).project;
    expect(cut.sounds).toHaveLength(1);
    expect(deleteClip(cut, clip.id).sounds).toHaveLength(1);
  });
});

describe('the arrangement as a whole', () => {
  it('runs as long as its last clip, which may hang off the last beat', () => {
    const { p, sound, track } = build();
    const late = addClip(p, { trackId: track.id, soundId: sound.id, at: 28, dur: 6, spans: SPANS });
    expect(soundLength(late.project, SPANS)).toBe(34);
    expect(soundLength(deleteClip(late.project, late.clip.id), SPANS)).toBe(20);
  });
  it('snaps to the nearest mark within the tolerance, and nowhere otherwise', () => {
    expect(snapTime(10.2, [0, 10, 20], 0.5)).toBe(10);
    expect(snapTime(10.9, [0, 10, 20], 0.5)).toBe(10.9);
    expect(snapTime(-5, [0], 0.5)).toBe(0);
  });
  it('reads a length the way a cut is read', () => {
    expect(fmtClock(3.25)).toBe('3.3s');
    expect(fmtClock(75)).toBe('1:15');
    expect(fmtClock(-1)).toBe('0.0s');
  });
});

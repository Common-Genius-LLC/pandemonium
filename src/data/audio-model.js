// Sound: the files, the tracks they are laid out on, and the clips cut from
// them. Pure and DOM-free, like every other reducer in this folder; the panel
// renders it and the engine plays it, neither of them decides it.
//
// THREE COLLECTIONS, NOT ONE TREE.
//
//   project.sounds   the audio FILES. One record per file, holding the bytes
//                    once (a data URL, lifted into the asset store on sync,
//                    exactly as a storyboard frame is).
//   project.tracks   the lanes. A project has as many as the writer wants.
//   project.clips    what is heard: a piece of one sound, on one track, at one
//                    place in the storyboard.
//
// They are flat and id-keyed for a reason that is not tidiness: the three-way
// merge (data/merge.js) merges id-keyed collections as sets, so three
// collections at the top of the project merge for free, where one nested
// `audio` object would have been one field two devices fight over. Cutting a
// clip in two therefore never duplicates audio either: both halves point at the
// same sound and carry their own window into it.
//
// SYNCHRONISED WITH THE STORYBOARD, NOT WITH A STOPWATCH.
//
// A clip is stored as "this far into THAT storyboard" (`boardId` + `offset`),
// not as an absolute number of seconds. Storyboards are what the sound is being
// cut against, and their durations change: recording the pacing of a show
// (slideshow.js) replaces an estimate with a measurement, and a reorder moves a
// beat. With an absolute start, every clip after the change would be in the
// wrong place and the writer would have to drag them all back. Anchored, the
// sound moves with the beat it was placed against, which is the whole of what
// "in sync with the storyboard" can honestly mean here.
//
// A clip placed before the first storyboard, or in a project with none, is
// absolute (boardId null, offset counted from the top); so is a clip whose
// storyboard has since been deleted, which is why clipStart falls back to the
// offset rather than dropping the clip.
'use strict';

import { uid } from '../utils/format.js';

// The smallest clip worth keeping, in seconds. A drag or a cut that would make
// something shorter is refused rather than leaving an inaudible sliver on the
// track.
export const MIN_CLIP = 0.05;

export const DEFAULT_TRACK_NAMES = ['Dialogue', 'Music', 'Atmos', 'Effects'];

const list = (project, key) => project[key] || [];
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
// Every stored time is rounded to the millisecond. Not for tidiness: clamping a
// drag against a limit (dur - MIN_CLIP, then back) leaves binary-float dust, and
// a clip whose length reads 0.04999999999999982 fails its own minimum the next
// time it is touched. A millisecond is far finer than anything that can be
// dragged or heard.
const ms = (v) => Math.round(num(v) * 1000) / 1000;

// ---- sounds (the files) ----

export function addSound(project, { name, mime, data, dur } = {}) {
  const sound = {
    id: uid(),
    name: (name || 'Sound').trim(),
    mime: mime || '',
    data: data || '',
    // As decoded by the browser. 0 means "not known yet", and the panel says so
    // rather than drawing a clip of a made-up length (hard rule 3).
    dur: Math.max(0, num(dur)),
    createdAt: Date.now(),
  };
  return { project: { ...project, sounds: [...list(project, 'sounds'), sound] }, sound };
}

export function updateSound(project, id, patch) {
  return { ...project, sounds: list(project, 'sounds').map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)) };
}

// Deleting a sound takes every clip cut from it: a clip with no sound is
// silence that still draws a block on the track.
export function deleteSound(project, id) {
  return {
    ...project,
    sounds: list(project, 'sounds').filter((s) => s.id !== id),
    clips: list(project, 'clips').filter((c) => c.soundId !== id),
  };
}

export function soundById(project, id) {
  return list(project, 'sounds').find((s) => s.id === id) || null;
}

// ---- tracks ----

export function addTrack(project, { name } = {}) {
  const tracks = list(project, 'tracks');
  const seq = tracks.reduce((m, t) => Math.max(m, num(t.seq)), -1) + 1;
  const track = {
    id: uid(),
    // Named after what the writer is most likely laying down next, in the order
    // a mix is usually built, so a new track rarely needs renaming.
    name: (name || DEFAULT_TRACK_NAMES[Math.min(seq, DEFAULT_TRACK_NAMES.length - 1)] || 'Track').trim(),
    seq,
    mute: false,
    gain: 1,
    createdAt: Date.now(),
  };
  return { project: { ...project, tracks: [...tracks, track] }, track };
}

export function updateTrack(project, id, patch) {
  return { ...project, tracks: list(project, 'tracks').map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)) };
}

export function deleteTrack(project, id) {
  return {
    ...project,
    tracks: list(project, 'tracks').filter((t) => t.id !== id),
    clips: list(project, 'clips').filter((c) => c.trackId !== id),
  };
}

// Tracks in the order they are stacked. `seq` is explicit so a reorder is a
// field change rather than an array move (the merge is set-based and would not
// preserve an array's order).
export function orderedTracks(project) {
  return list(project, 'tracks').slice().sort((a, b) => num(a.seq) - num(b.seq) || String(a.id).localeCompare(String(b.id)));
}

// Moves a track up (-1) or down (+1) the stack, by swapping its seq with its
// neighbour's, so no other track has to be rewritten.
export function moveTrack(project, id, delta) {
  const order = orderedTracks(project);
  const i = order.findIndex((t) => t.id === id);
  const j = i + (delta < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= order.length) return project;
  const a = order[i];
  const b = order[j];
  return {
    ...project,
    tracks: list(project, 'tracks').map((t) => {
      if (t.id === a.id) return { ...t, seq: num(b.seq) };
      if (t.id === b.id) return { ...t, seq: num(a.seq) };
      return t;
    }),
  };
}

// ---- the storyboard's timebase ----

// Where a clip starts, in seconds from the top, given the storyboard spans
// (see boardSpans in state/selectors.js). An anchored clip is "offset seconds
// into that board"; everything else is counted from the top.
export function clipStart(clip, spans) {
  const off = num(clip.offset);
  if (!clip.boardId) return Math.max(0, off);
  const span = (spans || []).find((s) => s.boardId === clip.boardId);
  return Math.max(0, span ? span.start + off : off);
}

export function clipEnd(clip, spans) {
  return clipStart(clip, spans) + Math.max(0, num(clip.dur));
}

// What a time on the timeline means as an anchor: the storyboard it falls in
// (or the last one before it), and how far into that storyboard it is. Before
// the first storyboard, or with none at all, it stays absolute.
export function anchorAt(spans, time) {
  const t = Math.max(0, num(time));
  const all = spans || [];
  let hit = null;
  for (const s of all) {
    if (s.start <= t) hit = s;
    else break;
  }
  if (!hit) return { boardId: null, offset: ms(t) };
  return { boardId: hit.boardId, offset: ms(t - hit.start) };
}

// ---- clips ----

// `at` is where on the timeline the clip starts, in seconds; it is turned into
// an anchor here so no caller has to know the anchoring rule. `inPoint` and
// `dur` are the window into the sound.
export function addClip(project, { trackId, soundId, at = 0, inPoint = 0, dur = null, gain = 1, spans = null } = {}) {
  const sound = soundById(project, soundId);
  const full = sound ? sound.dur : 0;
  const start = Math.max(0, num(inPoint));
  // A clip can never point outside its sound: with a known duration the window
  // is clamped to it, and with an unknown one (a file the browser could not
  // decode yet) whatever the caller asked for is kept.
  const length = full ? Math.min(Math.max(MIN_CLIP, num(dur, full)), Math.max(MIN_CLIP, full - start)) : Math.max(MIN_CLIP, num(dur));
  const anchor = anchorAt(spans, at);
  const clip = {
    id: uid(),
    trackId,
    soundId,
    boardId: anchor.boardId,
    offset: anchor.offset,
    in: ms(start),
    dur: ms(length),
    gain: num(gain, 1),
    createdAt: Date.now(),
  };
  return { project: { ...project, clips: [...list(project, 'clips'), clip] }, clip };
}

export function updateClip(project, id, patch) {
  return { ...project, clips: list(project, 'clips').map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)) };
}

export function deleteClip(project, id) {
  return { ...project, clips: list(project, 'clips').filter((c) => c.id !== id) };
}

export function clipById(project, id) {
  return list(project, 'clips').find((c) => c.id === id) || null;
}

// Rearranging: a clip goes to another time, another track, or both. It is
// re-anchored to whatever storyboard it has landed on, which is what makes a
// drag mean "this sound belongs to that beat".
export function moveClip(project, id, { at, trackId, spans = null } = {}) {
  const clip = clipById(project, id);
  if (!clip) return project;
  const anchor = at == null ? { boardId: clip.boardId, offset: clip.offset } : anchorAt(spans, at);
  return updateClip(project, id, {
    boardId: anchor.boardId,
    offset: anchor.offset,
    trackId: trackId || clip.trackId,
  });
}

// Cutting. `at` is a time on the TIMELINE, not inside the clip: that is what
// the writer points at (the playhead, or where they clicked). The left half
// keeps the clip's id so anything holding it still holds something, and the
// right half is a new clip over the rest of the same sound, re-anchored to
// wherever the cut falls.
export function splitClip(project, id, at, spans = null) {
  const clip = clipById(project, id);
  if (!clip) return { project, clip: null };
  const start = clipStart(clip, spans);
  const into = num(at) - start;
  if (into < MIN_CLIP || into > num(clip.dur) - MIN_CLIP) return { project, clip: null };
  const anchor = anchorAt(spans, num(at));
  const right = {
    ...clip,
    id: uid(),
    boardId: anchor.boardId,
    offset: anchor.offset,
    in: ms(num(clip.in) + into),
    dur: ms(num(clip.dur) - into),
    createdAt: Date.now(),
  };
  const left = { ...clip, dur: ms(into) };
  return {
    project: { ...project, clips: list(project, 'clips').map((c) => (c.id === id ? left : c)).concat([right]) },
    clip: right,
  };
}

// Trimming an edge. The head moves the clip's start in the sound AND on the
// timeline together, so the audio under the pointer does not slide; the tail
// only changes the length. Both are held inside the sound and above MIN_CLIP.
export function trimClip(project, id, { head = 0, tail = 0, spans = null } = {}) {
  const clip = clipById(project, id);
  if (!clip) return project;
  const sound = soundById(project, clip.soundId);
  const full = sound ? sound.dur : 0;
  let inPoint = num(clip.in);
  let dur = num(clip.dur);
  let start = clipStart(clip, spans);

  if (head) {
    const limit = dur - MIN_CLIP;
    const d = Math.max(-inPoint, Math.min(num(head), limit));
    inPoint += d;
    dur -= d;
    start += d;
  }
  if (tail) {
    const room = full ? full - inPoint : Infinity;
    dur = Math.max(MIN_CLIP, Math.min(dur + num(tail), room));
  }
  if (start < 0) start = 0;
  const anchor = clip.boardId
    ? { boardId: clip.boardId, offset: ms(num(clip.offset) + (start - clipStart(clip, spans))) }
    : { boardId: null, offset: ms(start) };
  return updateClip(project, id, { in: ms(inPoint), dur: ms(dur), boardId: anchor.boardId, offset: anchor.offset });
}

// ---- reading the arrangement ----

// Every clip on one track, in the order it is heard, with its absolute start
// worked out. This is what the panel draws and what the engine plays.
export function trackClips(project, trackId, spans) {
  return list(project, 'clips')
    .filter((c) => c.trackId === trackId)
    .map((c) => ({ clip: c, start: clipStart(c, spans), end: clipEnd(c, spans) }))
    .sort((a, b) => a.start - b.start);
}

// How long the sound runs, which is not how long the storyboard runs: a clip
// may hang off the end of the last beat.
export function soundLength(project, spans) {
  return list(project, 'clips').reduce((m, c) => Math.max(m, clipEnd(c, spans)), 0);
}

// What is heard from `from` onwards, as plain numbers the engine can schedule
// without knowing anything about storyboards: when each clip starts relative to
// `from`, how far into its sound to begin, and for how long. A muted track is
// left out, and a clip already finished by `from` never appears.
export function playPlan(project, spans, from = 0) {
  const t0 = Math.max(0, num(from));
  const muted = new Set(list(project, 'tracks').filter((t) => t.mute).map((t) => t.id));
  const out = [];
  for (const c of list(project, 'clips')) {
    if (muted.has(c.trackId)) continue;
    const sound = soundById(project, c.soundId);
    if (!sound) continue;
    const start = clipStart(c, spans);
    const end = start + num(c.dur);
    if (end <= t0) continue;
    const late = Math.max(0, t0 - start); // the playhead is already inside the clip
    const track = list(project, 'tracks').find((t) => t.id === c.trackId);
    out.push({
      clipId: c.id,
      soundId: c.soundId,
      when: Math.max(0, start - t0),
      offset: num(c.in) + late,
      dur: num(c.dur) - late,
      gain: num(c.gain, 1) * num(track && track.gain, 1),
    });
  }
  return out.sort((a, b) => a.when - b.when);
}

// Snapping, while a clip is dragged or trimmed. `marks` are the times worth
// landing on (every storyboard boundary, the playhead, the other clips' edges)
// and `tol` the tolerance in SECONDS, which the panel works out from its own
// zoom so that snapping feels the same at every scale.
export function snapTime(time, marks, tol) {
  const t = num(time);
  let best = t;
  let d = num(tol, 0);
  for (const m of marks || []) {
    const gap = Math.abs(m - t);
    if (gap <= d) { d = gap; best = m; }
  }
  return Math.max(0, best);
}

// A sound's own length, formatted the way a clip's length is read while
// cutting: seconds with one decimal under ten seconds, then m:ss.
export function fmtClock(secs) {
  const s = Math.max(0, num(secs));
  if (s < 10) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}

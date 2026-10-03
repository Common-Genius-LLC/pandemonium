// Playing the arrangement. One engine for the app, because there is one set of
// speakers: the sound panel and the preview both drive this, and whichever
// starts last owns it.
//
// Web Audio rather than <audio> elements, for one reason that matters: a clip
// is a WINDOW into a file (start here, run for this long) and several of them
// have to begin at exactly the right moment on several tracks at once.
// AudioBufferSourceNode.start(when, offset, duration) is that in one call,
// scheduled against the audio clock instead of a timer the browser is free to
// delay. An <audio> element can only seek and hope.
//
// What to play is worked out by playPlan (data/audio-model.js) and arrives here
// as plain numbers. This file knows nothing about storyboards, tracks or
// anchoring, and nothing about the store.
'use strict';

// A file's length, read without an AudioContext so a sound can be measured the
// moment it is imported (a context created before the first gesture is
// suspended, and some browsers refuse one outright). Resolves 0 when the
// browser cannot tell, which is reported as unknown rather than guessed.
export function measureDuration(dataUrl) {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      el.removeAttribute('src');
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => finish(el.duration));
    el.addEventListener('error', () => finish(0));
    // A file the browser never answers about must not leave the panel waiting.
    setTimeout(() => finish(el.duration), 8000);
    el.src = dataUrl;
  });
}

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // sound id -> AudioBuffer (or null when it will not decode)
    this.sources = [];
    this.playing = false;
    this.at = 0; // where the playhead was when it last stopped
    this.base = 0; // ctx.currentTime the current run started from
    this.from = 0; // the timeline position that run started at
    this.generation = 0; // bumped by every play/stop, so a late decode is dropped
  }

  #context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get isPlaying() { return this.playing; }

  // Where the playhead is, in seconds from the top of the arrangement.
  get time() {
    if (!this.playing || !this.ctx) return this.at;
    return this.from + (this.ctx.currentTime - this.base);
  }

  // Decodes a sound once and keeps it. `sound` is the stored record
  // ({id, data}); a record whose bytes are still an asset id on the server has
  // nothing to decode and is skipped (db.js hydrates them on load).
  async buffer(sound) {
    if (!sound || !sound.data) return null;
    if (this.buffers.has(sound.id)) return this.buffers.get(sound.id);
    const ctx = this.#context();
    if (!ctx) return null;
    try {
      const bytes = await (await fetch(sound.data)).arrayBuffer();
      const buf = await ctx.decodeAudioData(bytes);
      this.buffers.set(sound.id, buf);
      return buf;
    } catch {
      // A file the browser cannot decode is remembered as undecodable, so the
      // panel is not asked to try again on every play.
      this.buffers.set(sound.id, null);
      return null;
    }
  }

  // `plan` is playPlan()'s output and `sounds` the records to read the bytes
  // from. Returns the generation this run belongs to.
  async play(plan, from, sounds) {
    this.stop(from);
    const gen = ++this.generation;
    const ctx = this.#context();
    if (!ctx) return gen;
    const byId = new Map((sounds || []).map((s) => [s.id, s]));
    // Decoded before anything is scheduled, so the whole run starts together
    // rather than clip by clip as each file finishes decoding.
    const bufs = new Map();
    for (const item of plan) {
      if (bufs.has(item.soundId)) continue;
      bufs.set(item.soundId, await this.buffer(byId.get(item.soundId)));
    }
    // Something else started (or stopped) playing while we were decoding.
    if (gen !== this.generation) return gen;

    // A beat of lead-in, so the first clip is scheduled rather than started
    // late: with when === 0 the browser can miss its own deadline.
    const lead = 0.06;
    this.base = ctx.currentTime + lead;
    this.from = Math.max(0, from || 0);
    this.at = this.from;
    this.playing = true;

    for (const item of plan) {
      const buf = bufs.get(item.soundId);
      if (!buf) continue;
      if (item.offset >= buf.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(2, item.gain == null ? 1 : item.gain));
      src.connect(gain).connect(ctx.destination);
      const dur = Math.min(item.dur, buf.duration - item.offset);
      if (dur <= 0) continue;
      src.start(this.base + item.when, item.offset, dur);
      this.sources.push(src);
    }
    return gen;
  }

  // Keeps the playhead where it is, so Play carries on from there.
  pause() {
    const where = this.time;
    this.#silence();
    this.at = where;
    this.playing = false;
  }

  // `to` is where the playhead should sit afterwards, which is where it was
  // asked to start from rather than 0 when this is the first half of a play.
  stop(to = 0) {
    this.#silence();
    this.at = Math.max(0, to || 0);
    this.playing = false;
  }

  #silence() {
    this.generation++;
    for (const src of this.sources) {
      try { src.stop(); } catch { /* already finished */ }
    }
    this.sources = [];
  }

  // Drops a decoded file, for when the sound it came from is deleted: a
  // decoded buffer is the whole file in memory and there is nothing left to
  // play it.
  forget(soundId) {
    this.buffers.delete(soundId);
  }
}

export const soundEngine = new SoundEngine();

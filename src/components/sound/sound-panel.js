'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import { dispatch } from '../../utils/events.js';
import { withGlobalItems } from '../../utils/context-menu.js';
import { readFileAsDataURL, isAudioFile, AUDIO_ACCEPT } from '../../utils/files.js';
import { boardSpans, spansPaced } from '../../state/selectors.js';
import {
  orderedTracks, trackClips, clipStart, soundLength, playPlan, snapTime, anchorAt,
  soundById, fmtClock, MIN_CLIP, clipColor,
} from '../../data/audio-model.js';
import { NOTE_COLORS, colorDot } from '../../data/research-doc.js';
import { clamp } from '../../utils/format.js';
import { soundEngine, measureDuration } from './audio-engine.js';
import { icon } from './icons.js';
import '../ui/button.js';
import '../ui/panel-picker.js';

// The sound panel: audio laid out against the storyboard.
//
// THE RULER IS THE STORYBOARD, NOT A STOPWATCH. The scale across the top is the
// storyboards in order, each as wide as it is long, and a clip is stored as
// "this far into that storyboard" (data/audio-model.js). So when the pacing of
// a beat is measured by playing the show, or a beat is reordered, the sound
// moves with the beat it was cut against instead of being left behind. The
// panel says, in the strip, whether those widths are measured or estimated,
// because a scale made of guesses must not look like a scale made of
// measurements (hard rule 3).
//
// WHAT CAN BE DONE HERE, and nothing else: bring sound in (a file picker, or
// drop files straight onto a track), lay it out (drag along a track, drag
// between tracks, trim either edge), cut it (at the playhead, or where the
// pointer is), stack it (as many tracks as the writer wants, each mutable), and
// hear it (play from the playhead). Everything is stored in the project, so it
// syncs and merges like the rest of it.
//
// The drag is NOT written to the store until the pointer is released: a clip
// dragged across four seconds would otherwise be forty project updates, each
// one re-rendering every other panel and queueing an autosave.
// The track-name column. Wide enough for two words of a name ("Room atmos",
// "Dialogue 2") beside the colour dot and the three buttons, which is what it
// takes for the names to be worth having.
const HEAD = 196;
const ROW = 56;
const RULER = 34;
// How far the zoom goes. The floor is a quarter of a pixel per second, which
// puts two hours of sound in 1800px: the point of zooming out is to see the
// whole thing at once, so the floor is set by that and not by what looks tidy.
const MIN_PPS = 0.25;
const MAX_PPS = 400;
const ZOOM_STEP = 1.6;
const SNAP_PX = 7;
// Below this, the arrangement is still given room to drop something into.
const MIN_SECONDS = 24;
// A data URL in the project, which is then an asset on the server. Past this a
// writer is better served by a warning than by a project that will not save.
const MAX_MB = 25;

export class PandemoniumSoundPanel extends LitElement {
  static properties = {
    leafId: {},
    _pps: { state: true },
    _time: { state: true },
    _playing: { state: true },
    _sel: { state: true },
    _drag: { state: true },
    _over: { state: true }, // the track a file is being dragged onto
    _dropping: { state: true }, // a file is over the panel
  };

  static styles = [panelStyles, css`
    .shell{position:relative}
    .chrome .sub{display:flex;align-items:center;gap:6px}
    .clock{font-family:var(--mono);font-size:11px;color:var(--ink)}
    .scale{font-size:10px;color:var(--mut)}
    .scale.est{color:var(--act)}
    /* pan-x pan-y, so a two-finger pinch reaches #onTouchMove instead of
       zooming the whole page, while one finger still scrolls the arrangement. */
    .pbody{overflow:auto;touch-action:pan-x pan-y}

    .grid{position:relative;min-width:100%;box-sizing:border-box}
    .row{display:flex;align-items:stretch}
    /* The names stay put while the arrangement scrolls sideways. */
    .head{
      position:sticky;left:0;z-index:3;flex:none;width:196px;box-sizing:border-box;
      display:flex;align-items:center;gap:4px;padding:0 6px;
      background:var(--pane-bg,var(--bg));
    }
    .head input{
      flex:1;min-width:64px;height:22px;padding:0 6px;font-family:var(--sans);font-size:11px;color:var(--ink);
      background:transparent;border:0;border-radius:var(--r);outline:0;text-overflow:ellipsis;
    }
    .head input:hover,.head input:focus{background:var(--panel)}
    .head button{
      flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:transparent;color:var(--mut);font-family:var(--sans);font-size:10px;font-weight:500;line-height:1;
    }
    .head button:hover{background:var(--panel);color:var(--ink)}
    .head button.mute.on{background:var(--danger);color:#fff}
    /* Solo is the yellow the app uses for "this one, attended to", the same
       token the comment pill wears. */
    .head button.solo.on{background:var(--act);color:var(--act-ink)}
    /* The track's colour, where its name is: the whole point of a colour is to
       be read at a glance, so it is on the lane's label and on its clips. */
    .head .dot{
      flex:none;width:8px;height:8px;border-radius:50%;background:var(--tint,var(--sound));
      box-shadow:0 0 0 1px rgba(0,0,0,.12);
    }

    /* The storyboard scale. One block per storyboard, as wide as it is long. */
    .ruler{height:34px;position:relative;cursor:pointer}
    .ruler .lane{position:relative;height:100%}
    .span{
      position:absolute;top:4px;bottom:4px;box-sizing:border-box;
      background:var(--ph);border-radius:7.64px;overflow:hidden;
      display:flex;align-items:center;gap:4px;padding:0 6px;
      font-family:var(--sans);font-size:10px;color:var(--mut);white-space:nowrap;
    }
    .span.paced{background:color-mix(in srgb, var(--board) 22%, var(--ph))}
    .span b{color:var(--ink);font-weight:500}
    .noboards{
      position:absolute;inset:4px auto 4px 8px;display:flex;align-items:center;
      font-family:var(--sans);font-size:10px;color:var(--mut);white-space:nowrap;
    }

    .trow{height:56px;border-top:0}
    .lane{position:relative;flex:none;height:100%;cursor:crosshair}
    /* Where one storyboard ends and the next begins, straight down the tracks:
       what the sound is being cut against has to be visible on the track, not
       only on the ruler. */
    .guide{position:absolute;top:0;bottom:0;width:1px;background:var(--ph);pointer-events:none}
    .lane.over{background:color-mix(in srgb, var(--sound) 16%, transparent)}

    .clip{
      position:absolute;top:7px;bottom:7px;box-sizing:border-box;
      background:var(--tint,var(--sound));color:#fff;border-radius:7.64px;overflow:hidden;
      display:flex;flex-direction:column;justify-content:center;gap:1px;padding:0 8px;
      font-family:var(--sans);font-size:10px;line-height:1.25;cursor:grab;touch-action:none;
      box-shadow:var(--elev-2);
    }
    .clip.sel{outline:2px solid var(--ink);outline-offset:1px}
    .clip.ghost{opacity:.85;cursor:grabbing}
    .clip .nm{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .clip .len{opacity:.85;white-space:nowrap}
    /* The two trim edges. Wide enough to hit, invisible until hovered. */
    .edge{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;background:rgba(0,0,0,.001)}
    .edge.l{left:0}
    .edge.r{right:0}
    .clip:hover .edge{background:rgba(255,255,255,.35)}

    .playhead{position:absolute;top:0;width:2px;background:var(--danger);z-index:4;pointer-events:none}
    /* The head is a handle: the line is thin and nobody should have to hit two
       pixels to scrub. Dragging it anywhere on the arrangement moves the
       playhead, and so does dragging on the ruler or on empty track. */
    .playhead .grip{
      position:absolute;top:0;left:-7px;width:16px;height:14px;border-radius:2px;
      background:var(--danger);pointer-events:auto;cursor:ew-resize;
    }
    .playhead .grip::after{
      content:"";position:absolute;left:5px;top:3px;width:6px;height:8px;
      border-left:1px solid rgba(255,255,255,.5);border-right:1px solid rgba(255,255,255,.5);
    }

    .addtrack{margin:8px 0 18px 202px}

    .nosound{
      height:100%;min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
      padding:24px;box-sizing:border-box;
    }
    .nosound p{width:320px;max-width:84%;margin:0;text-align:center;font-size:14px;line-height:18px;color:var(--mut)}
    @keyframes drop-in{from{opacity:0}}
    .dropzone{
      animation:drop-in var(--dur-1) var(--ease-out);
      position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;
      background:var(--sound);color:#fff;font-family:var(--sans);font-size:14px;font-weight:500;
      border-radius:20px;pointer-events:none;
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._pps = 24;
    this._time = 0;
    this._playing = false;
    this._sel = null;
    this._drag = null;
    this._over = null;
    this._dropping = false;
    this._raf = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onEnter = () => { this._hovered = true; };
    this._onLeave = () => { this._hovered = false; };
    this.addEventListener('mouseenter', this._onEnter);
    this.addEventListener('mouseleave', this._onLeave);
    // Space plays, S cuts, Delete removes: the keys an editing surface is
    // expected to answer. Bound at the document because a panel is not
    // focusable, and kept to presses aimed here (the pointer is over this
    // panel and nothing is being typed into), the same rule the references
    // panel uses for a paste.
    this._onKey = (e) => this.#onKey(e);
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    this.removeEventListener('mouseenter', this._onEnter);
    this.removeEventListener('mouseleave', this._onLeave);
    document.removeEventListener('keydown', this._onKey);
    cancelAnimationFrame(this._raf);
    // Leaving the panel is not a reason to keep playing: the transport is here.
    if (this._playing) soundEngine.pause();
    this._playing = false;
    super.disconnectedCallback();
  }

  // ---- the storyboard's scale ----

  #spans() {
    const state = this._store.store.getFinalState();
    if (!state) return [];
    return boardSpans(state.fparsed.blocks, state.R.boards);
  }

  #length(spans) {
    const project = this._store.project;
    const boards = spans.length ? spans[spans.length - 1].start + spans[spans.length - 1].dur : 0;
    return Math.max(MIN_SECONDS, boards, soundLength(project, spans) + 4);
  }

  #x(secs) { return secs * this._pps; }

  // ---- zoom ----
  //
  // Every zoom goes through here, so the time under a fixed point on screen
  // stays under it: that point is the pointer for a wheel-pinch, the middle of
  // the two fingers for a touch pinch, and the middle of the pane for the
  // buttons. Without it, zooming out walks the arrangement off the left of the
  // pane and the writer has to scroll back to find what they were looking at.
  #zoomTo(pps, clientX) {
    const body = this.renderRoot.querySelector('.pbody');
    const next = clamp(pps, MIN_PPS, MAX_PPS);
    if (!body || next === this._pps) return;
    const box = body.getBoundingClientRect();
    // Where to hold still, as an x inside the lanes (the names column is fixed).
    const holdAt = clientX == null ? box.left + HEAD + (box.width - HEAD) / 2 : clientX;
    const inLanes = Math.max(0, holdAt - box.left - HEAD + body.scrollLeft);
    const t = inLanes / this._pps;
    this._pps = next;
    this.updateComplete.then(() => {
      const keep = Math.max(0, holdAt - box.left - HEAD);
      body.scrollLeft = Math.max(0, t * next - keep);
    });
  }

  #zoomBy(factor, clientX) {
    this.#zoomTo(this._pps * factor, clientX);
  }

  // Trackpad pinch arrives as a wheel event with ctrlKey set (every browser
  // does this), so the same handler covers the gesture and Ctrl-wheel.
  #onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    // deltaY is in lines or pixels depending on the device; the exponent keeps
    // either feeling the same and keeps the factor positive.
    this.#zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX);
  }

  // Two fingers on a touch screen: the distance between them scales the zoom,
  // held about the point between them. A pinch starting mid-drag abandons the
  // drag rather than doing both at once.
  #onTouchDown(e) {
    if (e.pointerType !== 'touch') return;
    this._touches = this._touches || new Map();
    this._touches.set(e.pointerId, e.clientX);
    if (this._touches.size !== 2) return;
    const [a, b] = [...this._touches.values()];
    this._drag = null;
    this._pinch = { dist: Math.max(1, Math.abs(a - b)), pps: this._pps };
  }

  #onTouchMove(e) {
    if (e.pointerType !== 'touch' || !this._touches || !this._touches.has(e.pointerId)) return;
    this._touches.set(e.pointerId, e.clientX);
    if (!this._pinch || this._touches.size !== 2) return;
    e.preventDefault();
    const [a, b] = [...this._touches.values()];
    const dist = Math.max(1, Math.abs(a - b));
    this.#zoomTo(this._pinch.pps * (dist / this._pinch.dist), (a + b) / 2);
  }

  #onTouchUp(e) {
    if (!this._touches) return;
    this._touches.delete(e.pointerId);
    if (this._touches.size < 2) this._pinch = null;
  }

  #secsAt(clientX, laneEl) {
    const r = laneEl.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / this._pps);
  }

  // Everything worth landing on while dragging: every storyboard boundary, the
  // playhead, and the edges of the other clips on the same track.
  #marks(spans, exceptClipId, trackId) {
    const out = [0, this._time];
    for (const s of spans) { out.push(s.start); out.push(s.start + s.dur); }
    for (const o of trackClips(this._store.project, trackId, spans)) {
      if (o.clip.id === exceptClipId) continue;
      out.push(o.start);
      out.push(o.end);
    }
    return out;
  }

  // The zoom at which everything fits the pane, which is what zooming out is
  // usually after. Never closer than the floor, and never past 1:1 of the
  // widest useful scale.
  #fit() {
    const body = this.renderRoot.querySelector('.pbody');
    const spans = this.#spans();
    const len = this.#length(spans);
    if (!body || !len) return;
    const room = Math.max(120, body.clientWidth - HEAD - 16);
    this.#zoomTo(room / len, body.getBoundingClientRect().left + HEAD);
    this.updateComplete.then(() => { body.scrollLeft = 0; });
  }

  // ---- transport ----

  #play() {
    const project = this._store.project;
    const spans = this.#spans();
    // The playhead runs to the end of the arrangement OR the end of the
    // storyboard, whichever is further: watching it cross the beats is useful
    // even before there is any sound on them. With neither there is nothing to
    // play and nothing to watch.
    const end = Math.max(soundLength(project, spans), spans.length ? spans[spans.length - 1].start + spans[spans.length - 1].dur : 0);
    if (end <= 0) {
      dispatch(this, 'pandemonium-toast', { message: 'Nothing to play yet: add a sound, or link some storyboards.' });
      return;
    }
    const from = this._time >= end ? 0 : this._time;
    soundEngine.play(playPlan(project, spans, from), from, project.sounds || []);
    this._playing = true;
    this._time = from;
    this.#tick(end);
  }

  #tick(end) {
    cancelAnimationFrame(this._raf);
    const step = () => {
      if (!this._playing) return;
      this._time = soundEngine.time;
      if (end > 0 && this._time >= end) { this.#stop(); return; }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  #pause() {
    soundEngine.pause();
    this._playing = false;
    this._time = soundEngine.time;
    cancelAnimationFrame(this._raf);
  }

  #stop() {
    soundEngine.stop(0);
    this._playing = false;
    this._time = 0;
    cancelAnimationFrame(this._raf);
  }

  // Scrubbing: press anywhere on the ruler, on empty track, or on the
  // playhead's own handle, and drag. Playback is paused for the duration and
  // picked up again from where the playhead was let go, rather than being
  // restarted on every pointer move.
  #startScrub(e, laneEl) {
    if (e.button) return;
    e.preventDefault();
    const lane = laneEl || this.renderRoot.querySelector('.ruler .lane');
    if (!lane) return;
    const wasPlaying = this._playing;
    if (wasPlaying) this.#pause();
    const to = (ev) => { this._time = this.#secsAt(ev.clientX, lane); };
    to(e);
    const move = (ev) => to(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (wasPlaying) this.#play();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  #seek(secs) {
    const was = this._playing;
    if (was) soundEngine.pause();
    this._time = Math.max(0, secs);
    if (was) this.#play();
  }

  // ---- bringing sound in ----

  #pick() {
    const input = this.renderRoot.getElementById('soundFile');
    input.value = '';
    input.click();
  }

  async #onPicked(e) {
    await this.#addFiles(e.target.files || [], null, null);
  }

  // One clip per file, placed where it was dropped (or at the playhead when it
  // came from the file picker) on the track it was dropped on (or the first
  // one, making it if the project has none yet).
  async #addFiles(files, trackId, at) {
    const store = this._store.store;
    const list = [...files].filter((f) => isAudioFile(f));
    if (!list.length) {
      if (files.length) dispatch(this, 'pandemonium-toast', { message: 'That is not an audio file.' });
      return;
    }
    const spans = this.#spans();
    let where = at == null ? this._time : at;
    const lane = trackId || (orderedTracks(store.project)[0] || store.addTrack({})).id;
    let added = 0;
    for (const file of list) {
      if (file.size > MAX_MB * 1024 * 1024) {
        dispatch(this, 'pandemonium-toast', { message: `"${file.name}" is over ${MAX_MB}MB. Shorten it or export it smaller first.` });
        continue;
      }
      const data = await readFileAsDataURL(file);
      // Measured, never assumed: a file the browser will not decode reports 0,
      // and the clip says "length unknown" rather than drawing a made-up one.
      const dur = await measureDuration(data);
      const sound = store.addSound({ name: file.name, mime: file.type, data, dur });
      const clip = store.addClip({ trackId: lane, soundId: sound.id, at: where, dur: dur || MIN_CLIP, spans });
      this._sel = clip.id;
      added++;
      where += dur || 1;
    }
    if (!added) return;
    const anchor = anchorAt(spans, at == null ? this._time : at);
    dispatch(this, 'pandemonium-toast', {
      message: anchor.boardId
        ? 'Sound added, in sync with that storyboard. Drag it along the track, or drag its edges to trim.'
        : 'Sound added. Drag it along the track, or drag its edges to trim.',
    });
  }

  #dragHasFiles(dt) {
    return [...((dt && dt.types) || [])].includes('Files');
  }

  #onPanelDragOver(e) {
    if (!this.#dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!this._dropping) this._dropping = true;
  }

  #onPanelDragLeave(e) {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    this._dropping = false;
    this._over = null;
  }

  async #onPanelDrop(e) {
    if (!this.#dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    this._dropping = false;
    const lane = e.target.closest && e.target.closest('.lane');
    const trackId = lane ? lane.dataset.track : null;
    const at = lane && trackId ? this.#secsAt(e.clientX, lane) : null;
    this._over = null;
    await this.#addFiles(e.dataTransfer.files || [], trackId, at);
  }

  // ---- laying it out ----

  // One pointer gesture for all three: move the clip, trim its head, trim its
  // tail. Nothing is written until the pointer is released (see the note at the
  // top), so what is shown mid-drag is this preview.
  #grab(e, clip, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const spans = this.#spans();
    const lanes = [...this.renderRoot.querySelectorAll('.lane[data-track]')]
      .map((el) => ({ id: el.dataset.track, rect: el.getBoundingClientRect() }));
    const start = clipStart(clip, spans);
    this._sel = clip.id;
    this._drag = {
      id: clip.id, mode, spans, lanes,
      x0: e.clientX,
      at: start, dur: clip.dur, in: clip.in, trackId: clip.trackId,
      preAt: start, preDur: clip.dur, preIn: clip.in, preTrack: clip.trackId,
    };
    const move = (ev) => this.#drive(ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.#drop(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  #drive(e) {
    const d = this._drag;
    if (!d) return;
    const dt = (e.clientX - d.x0) / this._pps;
    const tol = SNAP_PX / this._pps;
    const sound = soundById(this._store.project, (this.#clip(d.id) || {}).soundId);
    const full = sound ? sound.dur : 0;

    if (d.mode === 'move') {
      const marks = this.#marks(d.spans, d.id, d.trackId);
      const at = snapTime(d.at + dt, marks.concat(marks.map((m) => m - d.dur)), tol);
      const lane = d.lanes.find((l) => e.clientY >= l.rect.top && e.clientY <= l.rect.bottom);
      this._drag = { ...d, preAt: Math.max(0, at), preTrack: lane ? lane.id : d.trackId };
      return;
    }
    if (d.mode === 'head') {
      const marks = this.#marks(d.spans, d.id, d.trackId);
      const wanted = snapTime(d.at + dt, marks, tol);
      // The head can go back as far as the start of the file and forward to
      // within MIN_CLIP of the tail.
      const delta = Math.max(-d.in, Math.min(wanted - d.at, d.dur - MIN_CLIP));
      this._drag = { ...d, preAt: d.at + delta, preIn: d.in + delta, preDur: d.dur - delta };
      return;
    }
    const marks = this.#marks(d.spans, d.id, d.trackId);
    const wantedEnd = snapTime(d.at + d.dur + dt, marks, tol);
    const room = full ? full - d.in : Infinity;
    this._drag = { ...d, preDur: Math.max(MIN_CLIP, Math.min(wantedEnd - d.at, room)) };
  }

  #drop() {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    const store = this._store.store;
    if (d.mode === 'move') {
      if (d.preAt === d.at && d.preTrack === d.trackId) return;
      store.moveClip(d.id, { at: d.preAt, trackId: d.preTrack, spans: d.spans });
      return;
    }
    if (d.mode === 'head') {
      const head = d.preIn - d.in;
      if (!head) return;
      store.trimClip(d.id, { head, spans: d.spans });
      return;
    }
    const tail = d.preDur - d.dur;
    if (!tail) return;
    store.trimClip(d.id, { tail, spans: d.spans });
  }

  #clip(id) {
    return (this._store.project.clips || []).find((c) => c.id === id) || null;
  }

  // ---- cutting, and the rest of a clip's actions ----

  #cut(id, at) {
    const spans = this.#spans();
    const made = this._store.store.splitClip(id, at, spans);
    if (!made) {
      dispatch(this, 'pandemonium-toast', { message: 'Nothing to cut there: the cut has to fall inside the clip.' });
      return;
    }
    this._sel = made.id;
  }

  #cutAtPlayhead() {
    const spans = this.#spans();
    const hit = (this._store.project.clips || []).find((c) => {
      const s = clipStart(c, spans);
      return this._time > s && this._time < s + c.dur;
    });
    if (!hit) {
      dispatch(this, 'pandemonium-toast', { message: 'Put the playhead over a clip to cut it.' });
      return;
    }
    this.#cut(hit.id, this._time);
  }

  #deleteClip(id) {
    this._store.store.deleteClip(id);
    if (this._sel === id) this._sel = null;
  }

  #clipMenu(e, clip) {
    e.preventDefault();
    e.stopPropagation();
    const lane = e.target.closest('.lane');
    const at = lane ? this.#secsAt(e.clientX, lane) : this._time;
    const spans = this.#spans();
    const tracks = orderedTracks(this._store.project).filter((t) => t.id !== clip.trackId);
    const items = [
      // Colour first, as a swatch row: it is the choice where the word for it
      // is worth less than the thing (see pd-menu's swatches, item 17). A
      // clip's own colour overrules its track's; "Track's colour" is how it
      // gives that back.
      {
        swatches: this.#swatches(clip.color, (key) => this._store.store.updateClip(clip.id, { color: key }), "Track's colour"),
      },
      { divider: true },
      { label: 'Cut here', fn: () => this.#cut(clip.id, at) },
      ...(tracks.length ? [{
        label: 'Move to track',
        fn: () => dispatch(this, 'pandemonium-open-menu', {
          x: e.clientX, y: e.clientY,
          items: tracks.map((t) => ({ label: t.name, fn: () => this._store.store.moveClip(clip.id, { trackId: t.id, spans }) })),
        }),
      }] : []),
      { divider: true },
      { label: 'Delete clip', danger: true, fn: () => this.#deleteClip(clip.id) },
    ];
    dispatch(this, 'pandemonium-open-menu', { x: e.clientX, y: e.clientY, items: withGlobalItems(this, items) });
  }

  // The six project colours as a swatch row, with the no-colour entry drawn in
  // the plain sound orange (which is what it renders as) rather than the grey
  // "plain" dot, so the row shows what each choice will look like.
  #swatches(current, fn, plainLabel) {
    return NOTE_COLORS.map((c) => ({
      label: c.key ? c.label : plainLabel,
      color: c.key ? c.dot : 'var(--sound)',
      selected: (current || null) === c.key,
      fn: () => fn(c.key),
    }));
  }

  #onKey(e) {
    if (!this._hovered) return;
    const path = e.composedPath();
    if (path.some((n) => n && n.tagName && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable))) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (this._playing) this.#pause(); else this.#play();
      return;
    }
    if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.#cutAtPlayhead();
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && this._sel) {
      e.preventDefault();
      this.#deleteClip(this._sel);
    }
  }

  // Something elsewhere had a beat in mind ("link to > Sound" on a script
  // passage, see script-editor.js): put the playhead there, bring it into view,
  // and consume the request so it happens once.
  updated() {
    const ui = this._store.ui;
    if (!ui || ui.soundSeek == null) return;
    const at = ui.soundSeek;
    this._store.store.setUI({ soundSeek: null });
    this.#seek(at);
    const body = this.renderRoot.querySelector('.pbody');
    if (body) body.scrollLeft = Math.max(0, this.#x(at) - 120);
  }

  // ---- rendering ----

  #tools(hasAny) {
    return html`
      <pd-button icon title=${this._playing ? 'Pause (space)' : 'Play from the playhead (space)'}
        variant=${this._playing ? 'dark' : 'default'}
        @click=${() => (this._playing ? this.#pause() : this.#play())}>${icon(this._playing ? 'pause' : 'play')}</pd-button>
      <pd-button icon title="Back to the start" @click=${() => this.#stop()}>${icon('stop')}</pd-button>
      ${hasAny ? html`
        <pd-button icon title="Cut the clip under the playhead (S)" @click=${() => this.#cutAtPlayhead()}>${icon('cut')}</pd-button>
      ` : nothing}
      <pd-button icon title="Add a sound file" @click=${() => this.#pick()}>${icon('audioAdd')}</pd-button>
      <pd-button icon title="Add a track" @click=${() => this._store.store.addTrack({})}>${icon('trackAdd')}</pd-button>
      <pd-button icon title="Zoom out (pinch, or Ctrl and the wheel)" ?disabled=${this._pps <= MIN_PPS}
        @click=${() => this.#zoomBy(1 / ZOOM_STEP)}>${icon('zoomOut')}</pd-button>
      <pd-button icon title="Zoom in (pinch, or Ctrl and the wheel)" ?disabled=${this._pps >= MAX_PPS}
        @click=${() => this.#zoomBy(ZOOM_STEP)}>${icon('zoomIn')}</pd-button>
      <pd-button title="Fit the whole arrangement in the pane" @click=${() => this.#fit()}>Fit</pd-button>
    `;
  }

  #ruler(spans, width) {
    const paced = spansPaced(spans);
    return html`
      <div class="row ruler">
        <div class="head">
          <span class="scale ${paced ? '' : 'est'}">${spans.length ? (paced ? 'Measured' : 'Estimated') : 'No storyboards'}</span>
        </div>
        <div class="lane" style="width:${width}px" @pointerdown=${(e) => this.#startScrub(e, e.currentTarget)}>
          ${spans.length ? spans.map((s, i) => html`
            <div class="span ${s.paced ? 'paced' : ''}"
              style="left:${this.#x(s.start)}px;width:${Math.max(2, this.#x(s.dur) - 2)}px"
              title=${`Storyboard ${i + 1}: ${fmtClock(s.dur)} ${s.paced ? '(measured pacing)' : '(estimated from the words it is linked to)'}`}>
              <b>${i + 1}</b>${s.o && s.o.bd.caption ? html`<span>${s.o.bd.caption}</span>` : nothing}
            </div>`)
            : html`<div class="noboards">Link some storyboards and they become the scale here.</div>`}
        </div>
      </div>
    `;
  }

  #clipBox(o, spans) {
    const clip = o.clip;
    const d = this._drag && this._drag.id === clip.id ? this._drag : null;
    const start = d ? d.preAt : o.start;
    const dur = d ? d.preDur : clip.dur;
    const sound = soundById(this._store.project, clip.soundId);
    const tint = clipColor(this._store.project, clip);
    const w = Math.max(6, this.#x(dur));
    return html`
      <div class="clip ${this._sel === clip.id ? 'sel' : ''} ${d ? 'ghost' : ''}"
        style=${`left:${this.#x(start)}px;width:${w}px` + (tint ? ';--tint:' + colorDot(tint) : '')}
        title=${`${sound ? sound.name : 'Sound'} · ${fmtClock(dur)}${sound && !sound.dur ? ' · length unknown' : ''}`}
        @pointerdown=${(e) => this.#grab(e, clip, 'move')}
        @contextmenu=${(e) => this.#clipMenu(e, clip)}
        @dblclick=${(e) => { e.stopPropagation(); const lane = e.target.closest('.lane'); this.#cut(clip.id, this.#secsAt(e.clientX, lane)); }}>
        <span class="nm">${sound ? sound.name : 'Sound'}</span>
        <span class="len">${fmtClock(dur)}</span>
        <div class="edge l" @pointerdown=${(e) => this.#grab(e, clip, 'head')}></div>
        <div class="edge r" @pointerdown=${(e) => this.#grab(e, clip, 'tail')}></div>
      </div>
    `;
  }

  #track(track, spans, width) {
    const store = this._store.store;
    const clips = trackClips(this._store.project, track.id, spans);
    const dragging = this._drag && this._drag.preTrack === track.id && this._drag.mode === 'move'
      ? this.#clip(this._drag.id) : null;
    const here = clips.filter((o) => !this._drag || this._drag.id !== o.clip.id || this._drag.mode !== 'move');
    return html`
      <div class="row trow">
        <div class="head" data-clarity-mask="true" style=${track.color ? '--tint:' + colorDot(track.color) : ''}>
          <span class="dot" title="This track's colour"></span>
          <input type="text" .value=${track.name} maxlength="40" title="Track name"
            @change=${(e) => store.updateTrack(track.id, { name: e.target.value.trim() || track.name })}
            @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>
          <button class="mute ${track.mute ? 'on' : ''}" title=${track.mute ? 'Unmute this track' : 'Mute this track'}
            @click=${() => store.updateTrack(track.id, { mute: !track.mute })}>M</button>
          <button class="solo ${track.solo ? 'on' : ''}"
            title=${track.solo ? 'Stop soloing: hear every track again' : 'Solo: hear only this track'}
            @click=${() => store.updateTrack(track.id, { solo: !track.solo })}>S</button>
          <button title="Track options" @click=${(e) => this.#trackMenu(e, track)}>&#8943;</button>
        </div>
        <div class="lane ${this._over === track.id ? 'over' : ''}" data-track=${track.id} style="width:${width}px"
          @pointerdown=${(e) => { if (e.target.classList.contains('lane')) this.#startScrub(e, e.currentTarget); }}
          @dragover=${(e) => { if (this.#dragHasFiles(e.dataTransfer)) { e.preventDefault(); if (this._over !== track.id) this._over = track.id; } }}>
          ${spans.map((s) => html`<div class="guide" style="left:${this.#x(s.start)}px"></div>`)}
          ${here.map((o) => this.#clipBox(o, spans))}
          ${dragging ? this.#clipBox({ clip: dragging, start: this._drag.preAt }, spans) : nothing}
        </div>
      </div>
    `;
  }

  #trackMenu(e, track) {
    const store = this._store.store;
    const order = orderedTracks(store.project);
    const i = order.findIndex((t) => t.id === track.id);
    dispatch(this, 'pandemonium-open-menu', {
      anchor: e.currentTarget,
      items: [
        { swatches: this.#swatches(track.color, (key) => store.updateTrack(track.id, { color: key }), 'Plain') },
        { divider: true },
        ...(i > 0 ? [{ label: 'Move up', fn: () => store.moveTrack(track.id, -1) }] : []),
        ...(i < order.length - 1 ? [{ label: 'Move down', fn: () => store.moveTrack(track.id, 1) }] : []),
        { label: track.mute ? 'Unmute' : 'Mute', fn: () => store.updateTrack(track.id, { mute: !track.mute }) },
        { label: track.solo ? 'Stop soloing' : 'Solo', fn: () => store.updateTrack(track.id, { solo: !track.solo }) },
        { divider: true },
        { label: 'Delete track', danger: true, fn: () => store.deleteTrack(track.id) },
      ],
    });
  }

  #empty() {
    return html`
      <div class="nosound">
        <p>Bring in dialogue, music or atmos and lay it against the storyboard. Drop a file anywhere here, or add one.</p>
        <pd-button variant="act" @click=${() => this.#pick()}>Add a sound file</pd-button>
      </div>
    `;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const spans = this.#spans();
    const tracks = orderedTracks(project);
    const clips = project.clips || [];
    const hasAny = clips.length > 0;
    const length = this.#length(spans);
    const width = Math.max(240, this.#x(length));
    const total = soundLength(project, spans);

    return html`
      <div class="shell" style="--pane-bg:var(--bg)"
        @dragover=${(e) => this.#onPanelDragOver(e)}
        @dragleave=${(e) => this.#onPanelDragLeave(e)}
        @drop=${(e) => this.#onPanelDrop(e)}>
        <div class="chrome">
          <pd-panel-picker current="sound" .leafId=${this.leafId}></pd-panel-picker>
          <div class="sub">
            <span class="clock">${fmtClock(this._time)}${total ? ' / ' + fmtClock(total) : ''}</span>
          </div>
          <div class="tools">${this.#tools(hasAny)}</div>
        </div>
        <div class="pbody"
          @wheel=${(e) => this.#onWheel(e)}
          @pointerdown=${(e) => this.#onTouchDown(e)}
          @pointermove=${(e) => this.#onTouchMove(e)}
          @pointerup=${(e) => this.#onTouchUp(e)}
          @pointercancel=${(e) => this.#onTouchUp(e)}>
          ${!tracks.length && !hasAny ? this.#empty() : html`
            <div class="grid" style="width:${HEAD + width}px">
              ${this.#ruler(spans, width)}
              ${tracks.map((t) => this.#track(t, spans, width))}
              <div class="playhead" style="left:${HEAD + this.#x(this._time)}px;height:${RULER + tracks.length * ROW}px"
                ><span class="grip" title="Drag to scrub" @pointerdown=${(e) => this.#startScrub(e, null)}></span></div>
            </div>
            <div class="addtrack">
              <pd-button @click=${() => this._store.store.addTrack({})}>Add a track</pd-button>
            </div>`}
        </div>
        ${this._dropping ? html`<div class="dropzone">Drop to lay this sound on a track</div>` : nothing}
      </div>
      <input type="file" id="soundFile" accept=${AUDIO_ACCEPT} multiple style="display:none" @change=${(e) => this.#onPicked(e)}>
    `;
  }
}

customElements.define('pandemonium-sound-panel', PandemoniumSoundPanel);

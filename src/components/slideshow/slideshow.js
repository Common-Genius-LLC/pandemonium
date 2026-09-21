'use strict';

import { LitElement, html, css, nothing } from 'lit';
import '../ui/segmented.js';
import { crossfade } from '../../utils/motion.js';
import { StoreController } from '../../state/store-controller.js';
import { slidePlan, sceneExcerpt } from '../../state/selectors.js';
import { DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT, clampSplit, splitFromPointer, textScale } from './split.js';
import { frameImg } from '../../data/project-model.js';
import { readFileAsDataURL, isVideoSrc } from '../../utils/files.js';
import { keyed } from 'lit/directives/keyed.js';
import { parseFountain } from '../../fountain/parse.js';
import { plainRangeToRaw } from '../../fountain/doc-map.js';
import { snapToWords } from '../../fountain/resolve.js';

const SB_OPTIONS = [{ value: 'final', label: 'Final' }, { value: 'reference', label: 'Reference' }];
const SPLIT_KEY = 'pnd_show_split';
const MIN_PCT = MIN_SPLIT * 100;
const MAX_PCT = MAX_SPLIT * 100;

// Raw character offset of the start of 0-indexed line `lineIdx` in `text`.
// The plain-text-string counterpart of CodeMirror's doc.line(n).from, needed
// here because the slideshow edits the script's text directly, with no
// editor instance backing it.
function lineStartOffset(text, lineIdx) {
  let off = 0, n = 0;
  while (n < lineIdx) {
    const nl = text.indexOf('\n', off);
    if (nl < 0) return text.length;
    off = nl + 1;
    n++;
  }
  return off;
}

// Fullscreen playback: image on top, the linked (or nearest) script excerpt
// in the bottom fifth. One instance at app-root, opened via
// `pandemonium-open-slideshow`.
export class PandemoniumSlideshow extends LitElement {
  static properties = { _open: { state: true }, _slides: { state: true }, _ix: { state: true }, _recording: { state: true }, _sbMode: { state: true }, _split: { state: true } };

  // Playback is always dark, whatever the app around it is doing: this is a
  // room-lights-down surface, so the colours are literals here rather than the
  // page tokens (which are built for the light editor). --res is the one token
  // that carries through, as the progress fill.
  static styles = css`
    :host{position:fixed;inset:0;z-index:85;background:#000;display:none;flex-direction:column;font-family:var(--sans);--sink:#f2f2f2;--smut:#9a9a9a}
    :host([data-open]){display:flex}
    /* container-type:size so the placeholder frames below can be sized against
       the room the stage actually has (cqw/cqh), the way the picture is fitted
       into it. The stage's height comes from the flex column, not its
       contents, so it can be a size container. */
    .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;container-type:size}
    /* The picture is fitted to the stage, never cropped to fill it: it fills
       the box and object-fit:contain letterboxes it, so it scales up and down
       with the stage (the divider below resizes the stage) at its own aspect
       ratio. Absolutely placed so its size is the stage's, not its own. */
    .stage img,.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
    /* An image can be dropped straight onto the slide on screen, so the slide
       has to say when it will accept one. Inset rather than a border so the
       frame does not shift under the presenter mid-drag. */
    .stage.dropping::after{content:"";position:absolute;inset:10px;outline:2px dashed var(--res);border-radius:3px;pointer-events:none}
    /* Both placeholder frames are 16:9 and fitted to the stage like a picture
       would be: as wide as 80% of it allows without being taller than 80% of
       it. A blank storyboard is a shot waiting for its image; an unlinked frame
       is script no storyboard covers. Different fills so they never read as
       one another. */
    .noimg,.unlinked{width:min(80cqw,calc(80cqh * 16 / 9));aspect-ratio:16/9;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;color:var(--smut);text-align:center;padding:24px;box-sizing:border-box;overflow:hidden;border-radius:2px}
    .noimg{background:#1a1a1a}
    .unlinked{background:#101010}
    .noimg-hint,.unl-tag{font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    .unl-tag{color:var(--sink);font-weight:600}
    .unl-hint{font-size:12px;line-height:1.4;max-width:34ch}
    /* The storyboard's own note, standing in for the shot that is not drawn yet. */
    .shotnote{font-family:var(--sans);font-size:clamp(15px,1.6vw,22px);line-height:1.35;color:var(--sink);white-space:pre-wrap;overflow-wrap:anywhere;max-height:70%;overflow:hidden}
    button{color:var(--sink);background:rgba(255,255,255,.12);border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--sans)}
    button:hover:not(:disabled){background:rgba(255,255,255,.26)}
    button:disabled{opacity:.25;cursor:default}
    .x{position:absolute;z-index:1;top:14px;right:16px;width:28px;height:28px;font-size:14px;border-radius:50%}
    .nav{position:absolute;z-index:1;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;font-size:17px;line-height:1}
    .nav.prev{left:16px}
    .nav.next{right:16px}
    /* The strip's height is the writer's to set (see .split): it is inline,
       from _split. --txt-scale carries how much room that is, so the type
       grows and shrinks with it. */
    .bottom{flex:none;background:#0d0d0d;display:flex;flex-direction:column}
    /* The divider. Zero height, so it takes no room of its own: a wide, invisible
       hit area straddles the seam between picture and strip, and a small grip
       shows on it (brighter on hover, focus and while dragging). */
    .split{flex:none;height:0;position:relative;z-index:6;outline:none;touch-action:none}
    .split::before{content:"";position:absolute;left:0;right:0;top:-8px;height:16px;cursor:row-resize}
    .split::after{content:"";position:absolute;left:50%;top:-9px;width:46px;height:4px;margin-left:-23px;border-radius:2px;
      background:rgba(255,255,255,.22);transition:background var(--dur-1) var(--ease-out);pointer-events:none}
    .split:hover::after,.split:focus-visible::after,.split.drag::after{background:rgba(255,255,255,.6)}
    .split:focus-visible::after{background:var(--res)}
    /* The shared sliding switch (ui/segmented.js), in the show's own
       lights-down colours (this surface is one of the two documented places
       literals are allowed). */
    .sbswitch{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:5;
      --seg-track:rgba(255,255,255,.12);--seg-thumb:#fff;--seg-ink:rgba(255,255,255,.7);
      --seg-ink-hover:#fff;--seg-ink-on:#111}
    .rec{position:absolute;top:14px;left:16px;z-index:5;display:flex;align-items:center;gap:6px;
      font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
      color:#fff;background:rgba(207,21,158,.9);padding:5px 10px;border-radius:20px}
    .prog{height:3px;background:rgba(255,255,255,.14)}
    .prog i{display:block;height:100%;background:var(--res)}
    .txt{flex:1;min-height:0;display:flex;gap:24px;align-items:flex-start;padding:16px 26px;overflow:hidden}
    .txt .left{flex:1;min-width:0;height:100%;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
    .cap{margin-bottom:8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--smut)}
    .cap.note{text-transform:none;letter-spacing:normal;font-style:italic;font-size:13px;white-space:pre-wrap}
    /* Poster-sized by default; the actual size per slide comes from
       #lineSize() below, since a long excerpt has to step down to keep fitting
       the strip. Each script line is its own element (so it can be formatted
       as its element), and wrapping is forced on those (pre-wrap +
       break-word) so a long line never produces a horizontal scrollbar. The
       container itself must NOT be pre-wrap, or the template's own line breaks
       between the divs would print as blank lines. */
    .lines{font-family:var(--script);font-size:38px;line-height:1.3;color:var(--sink)}
    .lines > div{white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
    /* Editable in place: click a line, type, blur (or Enter) to commit --
       see #commitLineEdit. Esc reverts. Outline only on focus so the strip
       doesn't look like a form the rest of the time. */
    .lines > div[contenteditable]{cursor:text;border-radius:2px;outline:2px solid transparent;transition:outline-color .12s}
    .lines > div[contenteditable]:hover{outline-color:rgba(255,255,255,.18)}
    .lines > div[contenteditable]:focus{outline-color:var(--res)}
    /* The same screenplay formatting the editor applies (cm-theme.js), and
       self-contained for the same reason: one element must never inherit
       another's alignment or column. */
    .l-scene{text-align:left;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:700;font-style:normal;letter-spacing:.02em;color:var(--sink)}
    .l-action{text-align:left;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-character{text-align:center;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:700;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-paren{text-align:center;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--smut)}
    .l-dialogue{text-align:left;max-width:62%;margin:0 auto;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-transition{text-align:right;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:400;font-style:italic;letter-spacing:normal;color:var(--smut)}
    .l-centered{text-align:center;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-lyric{text-align:left;max-width:none;margin:0 0 0 1.5em;text-transform:none;font-weight:400;font-style:italic;letter-spacing:normal;color:var(--smut)}
    .l-section{text-align:left;max-width:none;margin:.4em 0 0;text-transform:none;font-weight:700;font-style:normal;letter-spacing:.01em;color:var(--sink)}
    .l-synopsis{text-align:left;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:italic;letter-spacing:normal;color:var(--smut)}
    .rightcol{flex:none;text-align:right;color:var(--smut);font-size:11px;display:flex;flex-direction:column;gap:4px}
    .rightcol .n{color:var(--sink);font-weight:500;font-size:12px}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
    this._slides = [];
    this._ix = 0;
    // Bumped on every editable-line blur (see #commitLineEdit) and used to
    // key the .lines container: contenteditable input, even a revert via
    // execCommand, can disturb Lit's own marker nodes inside an edited
    // line (browsers don't treat comment nodes as inert inside an editable
    // region), so the next render forces a clean remount rather than
    // attempting to patch whatever the browser left behind.
    this._editGen = 0;
    this._sbMode = 'final';
    // The divider between picture and script. A per-viewer convenience like a
    // remembered tab, so it survives a reload and every later preview, and
    // renders at the default when storage is unavailable.
    this._split = DEFAULT_SPLIT;
    try {
      const saved = parseFloat(localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(saved)) this._split = clampSplit(saved);
    } catch { /* private mode: keep the default */ }
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKey = (e) => {
      if (!this._open) return;
      // A line being edited (see #commitLineEdit) owns the keyboard: space
      // types a space, arrows move the caret, Escape reverts the line, not
      // the whole show. e.composedPath() is needed here, not e.target,
      // because the actual editable div lives inside this component's own
      // shadow root and e.target would just be this host element.
      if (e.composedPath().some((el) => el.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.#step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.#step(-1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.#setMode(this._sbMode === 'reference' ? 'final' : 'reference'); }
      else if (e.key === 'Escape') { this.close(); }
    };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  // The deck is planned in selectors.js (slidePlan): one slide per STORYBOARD,
  // in scene order, and one per stretch of script no storyboard covers. Every
  // storyboard has both a final and a reference frame, either of which may be
  // empty, so the deck is identical in either mode, slide for slide and line
  // for line: switching mode mid-show swaps only the image (or a blank, waiting
  // for one). A board's lines are its own linked passage, never a wider
  // excerpt, so Reference shows exactly the script Final does.
  //
  // Script between two linked passages plays too, as an unlinked slide: no
  // picture, a frame that says so, and the text along the bottom like any other
  // slide. That covers the rest of a scene after its last board, scenes with
  // none, and the top of the next scene before its first. Script before the
  // first link and after the last stays whole scenes folded into one
  // continuous slide each (see slidePlan).
  #buildSlides() {
    const store = this._store.store;
    const state = store.getFinalState();
    const scenes = state.fscenes, parsed = state.fparsed;
    // What a board is actually linked to: its resolved spans, in the block
    // each one landed in, so a part-line link shows just that part, formatted
    // as the element it came from. Each line carries bi/s/e (its span within
    // that block's plain text) so an in-show edit can be spliced back into the
    // document (see #commitLineEdit). partIndex is this span's position in the
    // board's own anchor.parts (not in the filtered/resolved list here, which
    // can skip an unresolved part and shift indices), so an edit can update the
    // exact part it came from.
    const boardLines = (o) => (o.res || [])
      .map((r, pi) => (r ? { r, pi } : null))
      .filter(Boolean)
      .map(({ r, pi }) => {
        const b = parsed.blocks[r.bi];
        return b ? { type: b.type, text: b.plain.slice(r.s, r.e), bi: r.bi, s: r.s, e: r.e, boardId: o.bd.id, partIndex: pi } : null;
      })
      .filter((l) => l && l.text);
    return slidePlan(parsed.blocks, scenes, state.R.boards).map((it) => {
      if (it.type === 'unlinked') return { boardId: null, img: null, unlinked: true, lines: it.lines };
      const o = it.o;
      const lines = boardLines(o);
      return {
        boardId: o.bd.id,
        img: frameImg(o.bd, this._sbMode),
        cap: o.bd.caption,
        note: o.bd.note,
        lines: lines.length ? lines : sceneExcerpt(parsed.blocks, scenes[o.sceneIdx]),
      };
    });
  }

  open(opts = {}) {
    // Which storyboard plays: opening from Reference shows references, from
    // Final shows finals; switchable in-show (top switch / up-down arrows).
    this._sbMode = opts.mode === 'reference' ? 'reference' : 'final';
    const slides = this.#buildSlides();
    if (!slides.length) {
      this.dispatchEvent(new CustomEvent('pandemonium-toast', { detail: { message: 'Nothing to play yet. Write the final draft first.' }, bubbles: true, composed: true }));
      return;
    }
    this._slides = slides;
    // "Preview from here" passes the board it was clicked on; land on that
    // board's slide instead of the start. Falls back to 0 when the board
    // isn't in this mode's slides (or none was requested).
    const startIx = opts.boardId ? slides.findIndex((s) => s.boardId === opts.boardId) : -1;
    this._ix = startIx >= 0 ? startIx : 0;
    this._open = true;
    // Record mode: time how long each slide holds the screen as the presenter
    // advances, and save that to the slide's board as its pacing (see #step /
    // #recordCurrent). This is what turns the timeline and duration from a
    // word-count estimate into a measured running time.
    this._recording = !!opts.record;
    this._slideStart = performance.now();
    this.setAttribute('data-open', '');
  }

  close() {
    if (this._recording) this.#recordCurrent(); // bank the final slide's dwell
    this._recording = false;
    this._open = false;
    this.removeAttribute('data-open');
  }

  // Save the time spent on the current slide to its board's pacing.
  #recordCurrent() {
    const slide = this._slides[this._ix];
    const secs = (performance.now() - this._slideStart) / 1000;
    this._slideStart = performance.now();
    if (slide && slide.boardId && secs >= 0.1 && secs < 3600) {
      this._store.store.setBoardDuration(slide.boardId, Math.round(secs * 10) / 10);
    }
  }

  #step(d) {
    // Advancing forward while recording commits the current slide's pacing.
    if (this._recording && d > 0) this.#recordCurrent();
    const was = this._ix;
    this._ix = Math.max(0, Math.min(this._slides.length - 1, this._ix + d));
    // A cut, softened: the next slide fades up rather than snapping in.
    if (this._ix !== was) this.updateComplete.then(() => crossfade(this.renderRoot.querySelector('.stage'), { duration: 160 }));
  }

  // Switch between the final and reference frames mid-show. Both builds walk
  // the same storyboards (see #buildSlides), so the deck is always the same
  // length and text in either mode and _ix keeps pointing at the same beat --
  // the empty-deck branch below is now only reachable when the script has no
  // storyboards at all, already caught by open().
  #setMode(mode) {
    if (this._sbMode === mode) return;
    this._sbMode = mode;
    const slides = this.#buildSlides();
    if (!slides.length) {
      this.dispatchEvent(new CustomEvent('pandemonium-toast', { detail: { message: `No ${mode} storyboard to show yet.` }, bubbles: true, composed: true }));
      this._sbMode = mode === 'reference' ? 'final' : 'reference';
      return;
    }
    this._slides = slides;
    this._ix = Math.min(this._ix, slides.length - 1);
    this._slideStart = performance.now();
    // The same beat, the other frame: the picture turns over in place.
    this.updateComplete.then(() => crossfade(this.renderRoot.querySelector('.stage')));
  }

  // The slide list is a snapshot taken at open(). Dropping an image changes
  // the project underneath it, so the snapshot has to be retaken, holding the
  // current index: the presenter must stay on the slide they just filled
  // rather than being thrown back to the top of the deck mid-talk.
  #refreshSlides() {
    if (!this._open) return;
    const ix = this._ix;
    this._slides = this.#buildSlides();
    this._ix = Math.max(0, Math.min(ix, this._slides.length - 1));
  }

  // Editing script text in the show: splice the edited line back into the
  // block it came from (line.s/e are its span within that block's plain
  // text), then re-parse and write the whole document, same as the main
  // editor writes back on every keystroke. If the line belongs to a board
  // (boardId/partIndex set, see #buildSlides), that board's own anchor part
  // is re-derived from the edited text in the same update, word-snapped like
  // a fresh capture (fountain/resolve.js), so the board doesn't go "lost"
  // over its own edit -- the same guarantee script-editor.js's #remapAnchors
  // gives typing in the main editor, just for this one line rather than
  // every anchor in the document (there is no CodeMirror transaction here to
  // map the others through).
  #commitLineEdit(lineIx, newText) {
    const slide = this._slides[this._ix];
    const line = slide && slide.lines && slide.lines[lineIx];
    if (!line || line.bi == null || newText === line.text) return;
    const store = this._store.store;
    const sc = store.finalScript();
    const parsed = parseFountain(sc.text);
    const block = parsed.blocks[line.bi];
    if (!block) return;
    const lineFrom = lineStartOffset(sc.text, block.line);
    const { from, to } = plainRangeToRaw(block, lineFrom, line.s, line.e);
    const fullText = sc.text.slice(0, from) + newText + sc.text.slice(to);

    let boards = null;
    if (line.boardId != null && line.partIndex != null) {
      const bd = store.project.boards.find((b) => b.id === line.boardId);
      const oldPart = bd && bd.anchor && bd.anchor.parts[line.partIndex];
      if (oldPart) {
        const newBlockPlain = block.plain.slice(0, line.s) + newText + block.plain.slice(line.e);
        const { s: ns, e: ne } = snapToWords(newBlockPlain, line.s, line.s + newText.length);
        const q = newBlockPlain.slice(ns, ne);
        if (q.trim()) {
          const parts = bd.anchor.parts.slice();
          parts[line.partIndex] = { q, b: line.bi, s: ns };
          boards = store.project.boards.map((b) => (b.id === bd.id ? { ...b, anchor: { parts } } : b));
        }
      }
    }
    store.applyLiveEdit(sc.id, fullText, boards, null, null);
    this.#refreshSlides();
  }

  #canDrop(e) {
    const slide = this._slides[this._ix];
    return !!(slide && slide.boardId && e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
  }

  #onDragOver(e) {
    if (!this.#canDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!this._dropping) { this._dropping = true; this.requestUpdate(); }
  }

  #onDragLeave() {
    if (this._dropping) { this._dropping = false; this.requestUpdate(); }
  }

  // Fill the slide on screen from a dropped image: it goes in the frame of the
  // mode being shown, of the storyboard the slide is (blank or not).
  async #onDrop(e) {
    if (!this.#canDrop(e)) return;
    e.preventDefault();
    this._dropping = false;
    const slide = this._slides[this._ix];
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) { this.requestUpdate(); return; }
    const dataUrl = await readFileAsDataURL(file);
    this._store.store.replaceBoardImage(slide.boardId, dataUrl, this._sbMode);
    this.#refreshSlides();
  }

  // ---- the divider between the picture and the script ----

  #setSplit(v, persist = false) {
    this._split = clampSplit(v);
    if (!persist) return;
    try { localStorage.setItem(SPLIT_KEY, String(this._split)); } catch { /* not persisted: fine */ }
  }

  #onSplitDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    this._dragSplit = true;
    e.currentTarget.classList.add('drag');
  }

  #onSplitMove(e) {
    if (!this._dragSplit) return;
    const box = this.getBoundingClientRect();
    this.#setSplit(splitFromPointer(e.clientY, box.top, box.height));
  }

  #onSplitUp(e) {
    if (!this._dragSplit) return;
    this._dragSplit = false;
    e.currentTarget.classList.remove('drag');
    this.#setSplit(this._split, true);
  }

  // Arrow keys move the divider by a few percent; Up gives the script more of
  // the screen, Down gives the picture more. Stopped here so they do not also
  // flip the show between Final and Reference (see the document keydown).
  #onSplitKey(e) {
    const step = e.shiftKey ? 0.1 : 0.03;
    if (e.key === 'ArrowUp') this.#setSplit(this._split + step, true);
    else if (e.key === 'ArrowDown') this.#setSplit(this._split - step, true);
    else if (e.key === 'Home') this.#setSplit(DEFAULT_SPLIT, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Script type size for one slide. A short line plays big; the longer the
  // excerpt, the further the type steps down, so the whole of it still fits
  // the bottom strip and wraps rather than scrolling. Linear between the two
  // ends, then expressed as a clamp so it also tracks the window: the px
  // figure is what you get at a 1440-wide viewport and the ceiling, narrower
  // windows scale down from it, and MIN is the floor.
  #lineSize(lines) {
    const n = (lines || []).reduce((t, l) => t + l.text.length + 1, 0);
    const SHORT = 90, LONG = 420, MAX = 42, MIN = 20;
    const t = Math.max(0, Math.min(1, (n - SHORT) / (LONG - SHORT)));
    const px = MAX - (MAX - MIN) * t;
    const fit = `clamp(${MIN}px, ${(px * 0.55).toFixed(1)}px + ${((px * 0.45) / 14.4).toFixed(2)}vw, ${px.toFixed(1)}px)`;
    // Then with the room the writer has given the strip (see split.js).
    return `calc(${fit} * var(--txt-scale, 1))`;
  }

  render() {
    if (!this._open || !this._slides.length) return nothing;
    const s = this._slides[this._ix];
    const last = this._slides.length - 1;
    return html`
      <div class="stage ${this._dropping ? 'dropping' : ''}"
        @click=${(e) => { if (!e.target.closest('button')) this.#step(1); }}
        @dragover=${(e) => this.#onDragOver(e)}
        @dragleave=${() => this.#onDragLeave()}
        @drop=${(e) => this.#onDrop(e)}>
        <button class="x" title="Close slideshow (Esc)" aria-label="Close slideshow" @click=${() => this.close()}>×</button>
        ${this._recording ? html`<div class="rec" title="Recording pacing: click to advance at your intended pace. Each slide's on-screen time is saved.">● REC pacing</div>` : ''}
        <pd-segmented class="sbswitch" title="Switch storyboard (Up/Down)" label="Which frame to show"
          .options=${SB_OPTIONS} .value=${this._sbMode === 'reference' ? 'reference' : 'final'}
          @click=${(e) => e.stopPropagation()}
          @change=${(e) => this.#setMode(e.detail.value)}></pd-segmented>
        <button class="nav prev" title="Previous slide (←)" aria-label="Previous slide"
          ?disabled=${this._ix === 0} @click=${() => this.#step(-1)}>‹</button>
        <button class="nav next" title="Next slide (→)" aria-label="Next slide"
          ?disabled=${this._ix === last} @click=${() => this.#step(1)}>›</button>
        ${s.img
          ? (isVideoSrc(s.img)
            ? html`<video src=${s.img} autoplay muted loop playsinline></video>`
            : html`<img alt="" src=${s.img}>`)
          : s.unlinked
            ? html`<div class="unlinked"><span class="unl-tag">Unlinked</span><span class="unl-hint">No storyboard is linked to this part of the script.</span></div>`
            : html`<div class="noimg">${s.note ? html`<span class="shotnote">${s.note}</span>` : ''}<span class="noimg-hint">Drop ${this._sbMode === 'reference' ? 'a reference' : 'the final'} image here</span></div>`}
      </div>
      <div class="split" role="separator" aria-orientation="horizontal" tabindex="0"
        aria-label="Resize the picture and the script. Up and Down arrows move it, Home resets it."
        aria-valuemin=${Math.round(MIN_PCT)} aria-valuemax=${Math.round(MAX_PCT)} aria-valuenow=${Math.round(this._split * 100)}
        title="Drag to resize. Double-click to reset."
        @pointerdown=${(e) => this.#onSplitDown(e)}
        @pointermove=${(e) => this.#onSplitMove(e)}
        @pointerup=${(e) => this.#onSplitUp(e)}
        @pointercancel=${(e) => this.#onSplitUp(e)}
        @dblclick=${() => this.#setSplit(DEFAULT_SPLIT, true)}
        @keydown=${(e) => this.#onSplitKey(e)}></div>
      <div class="bottom" style="height:${(this._split * 100).toFixed(2)}%;--txt-scale:${textScale(this._split).toFixed(3)}">
        <div class="prog"><i style="width:${((this._ix + 1) / this._slides.length) * 100}%"></i></div>
        <div class="txt">
          <div class="left">
            ${s.cap ? html`<div class="cap">${s.cap}</div>` : ''}
            ${s.note && s.img ? html`<div class="cap note">${s.note}</div>` : ''}
            <div class="lines" style="font-size:${this.#lineSize(s.lines)}">
              ${keyed(this._editGen, html`${(s.lines || []).map((l, i) => html`<div class="l-${l.type}"
                ?contenteditable=${l.bi != null}
                spellcheck="false"
                @click=${(e) => e.stopPropagation()}
                @keydown=${(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.target.blur(); }
                  if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    // Revert through the browser's own edit pipeline
                    // (execCommand), not el.textContent = ...: this div is
                    // Lit-templated, and replacing its children wholesale
                    // ejects Lit's own marker nodes and breaks every future
                    // render of it. execCommand mutates the existing text
                    // node in place instead, the same as if the user had
                    // selected-all and retyped it themselves.
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, l.text);
                    e.target.blur();
                  }
                }}
                @blur=${(e) => { this._editGen++; this.#commitLineEdit(i, e.target.textContent); }}
              >${l.text}</div>`)}`)}
            </div>
          </div>
          <div class="rightcol"><span class="n">${this._ix + 1} / ${this._slides.length}</span></div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-slideshow', PandemoniumSlideshow);

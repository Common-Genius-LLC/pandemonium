'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { CONTENT_TYPES } from '../../fountain/blocks.js';

// Fullscreen playback: image on top, the linked (or nearest) script excerpt
// in the bottom fifth. One instance at app-root, opened via
// `pandemonium-open-slideshow`.
export class PandemoniumSlideshow extends LitElement {
  static properties = { _open: { state: true }, _slides: { state: true }, _ix: { state: true } };

  // Playback is always dark, whatever the app around it is doing: this is a
  // room-lights-down surface, so the colours are literals here rather than the
  // page tokens (which are built for the light editor). --res is the one token
  // that carries through, as the progress fill.
  static styles = css`
    :host{position:fixed;inset:0;z-index:85;background:#000;display:none;flex-direction:column;font-family:var(--sans);--sink:#f2f2f2;--smut:#9a9a9a}
    :host([data-open]){display:flex}
    .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
    .stage img{max-width:100%;max-height:100%;object-fit:contain;display:block}
    .noimg{width:min(58%,640px);aspect-ratio:16/9;background:#1a1a1a;display:flex;align-items:center;justify-content:center;color:var(--smut);font-size:12px;letter-spacing:.08em;text-transform:uppercase;border-radius:2px}
    button{color:var(--sink);background:rgba(255,255,255,.12);border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--sans)}
    button:hover:not(:disabled){background:rgba(255,255,255,.26)}
    button:disabled{opacity:.25;cursor:default}
    .x{position:absolute;top:14px;right:16px;width:28px;height:28px;font-size:14px;border-radius:50%}
    .nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;font-size:17px;line-height:1}
    .nav.prev{left:16px}
    .nav.next{right:16px}
    .bottom{flex:none;height:30%;min-height:200px;background:#0d0d0d;display:flex;flex-direction:column}
    .prog{height:3px;background:rgba(255,255,255,.14)}
    .prog i{display:block;height:100%;background:var(--res)}
    .txt{flex:1;min-height:0;display:flex;gap:24px;align-items:flex-start;padding:16px 26px;overflow:hidden}
    .txt .left{flex:1;min-width:0;height:100%;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
    .scene{margin-bottom:8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--smut)}
    /* Poster-sized by default; the actual size per slide comes from
       #lineSize() below, since a long excerpt has to step down to keep fitting
       the strip. Each script line is its own element (so it can be formatted
       as its element), and wrapping is forced on those (pre-wrap +
       break-word) so a long line never produces a horizontal scrollbar. The
       container itself must NOT be pre-wrap, or the template's own line breaks
       between the divs would print as blank lines. */
    .lines{font-family:var(--script);font-size:38px;line-height:1.3;color:var(--sink)}
    .lines > div{white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
    /* The same screenplay formatting the editor applies (cm-theme.js), and
       self-contained for the same reason: one element must never inherit
       another's alignment or column. */
    .l-scene{text-align:left;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:700;font-style:normal;letter-spacing:.02em;color:var(--sink)}
    .l-action{text-align:left;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-character{text-align:center;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:700;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-paren{text-align:center;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--smut)}
    .l-dialogue{text-align:left;max-width:62%;margin:0 auto;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-transition{text-align:right;max-width:none;margin:.4em 0 0;text-transform:uppercase;font-weight:400;font-style:italic;letter-spacing:normal;color:var(--sink)}
    .l-centered{text-align:center;max-width:none;margin:0;text-transform:none;font-weight:400;font-style:normal;letter-spacing:normal;color:var(--sink)}
    .l-lyric{text-align:left;max-width:none;margin:0 0 0 1.5em;text-transform:none;font-weight:400;font-style:italic;letter-spacing:normal;color:var(--sink)}
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
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKey = (e) => {
      if (!this._open) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.#step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.#step(-1); }
      else if (e.key === 'Escape') { this.close(); }
    };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  #buildSlides() {
    const store = this._store.store;
    const state = store.getFinalState();
    const scenes = state.fscenes, parsed = state.fparsed;
    const byScene = scenes.map(() => []);
    state.R.boards.slice().sort((a, b) => a.firstBi - b.firstBi).forEach((o) => {
      if (o.ok && byScene[o.sceneIdx]) byScene[o.sceneIdx].push(o);
    });
    // Slide text is kept as [{type, text}], not a flat string: the strip
    // renders it with the same element formatting as the editor, and that
    // needs the parser's block type for every line rather than a guess made
    // from the words.
    const excerpt = (sc) => {
      const parts = [];
      let n = 0;
      for (let bi = Math.max(0, sc.start); bi <= sc.end && bi < parsed.blocks.length; bi++) {
        const b = parsed.blocks[bi];
        if (CONTENT_TYPES[b.type] && b.plain) {
          parts.push({ type: b.type, text: b.plain });
          n += b.plain.length;
          if (n > 340) break;
        }
      }
      return parts;
    };
    // What a board is actually linked to: its resolved spans, in the block
    // each one landed in, so a part-line link shows just that part, formatted
    // as the element it came from.
    const boardLines = (o) => (o.res || []).filter(Boolean).map((r) => {
      const b = parsed.blocks[r.bi];
      return b ? { type: b.type, text: b.plain.slice(r.s, r.e) } : null;
    }).filter((l) => l && l.text);
    const slides = [];
    scenes.forEach((sc, ix) => {
      if (sc.end < sc.start && !byScene[ix].length) return;
      const label = (sc.pre ? 'Opening' : 'Sc ' + sc.label) + ' · ' + sc.name;
      if (!byScene[ix].length) {
        const lines = excerpt(sc);
        slides.push({ img: null, label, lines: lines.length ? lines : [{ type: 'scene', text: sc.name }] });
        return;
      }
      byScene[ix].forEach((o) => {
        const lines = boardLines(o);
        slides.push({ img: o.bd.img, cap: o.bd.caption, label, lines: lines.length ? lines : excerpt(sc) });
      });
    });
    return slides;
  }

  open() {
    const slides = this.#buildSlides();
    if (!slides.length) {
      this.dispatchEvent(new CustomEvent('pandemonium-toast', { detail: { message: 'Nothing to play yet. Write the final draft first.' }, bubbles: true, composed: true }));
      return;
    }
    this._slides = slides;
    this._ix = 0;
    this._open = true;
    this.setAttribute('data-open', '');
  }

  close() {
    this._open = false;
    this.removeAttribute('data-open');
  }

  #step(d) {
    this._ix = Math.max(0, Math.min(this._slides.length - 1, this._ix + d));
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
    return `clamp(${MIN}px, ${(px * 0.55).toFixed(1)}px + ${((px * 0.45) / 14.4).toFixed(2)}vw, ${px.toFixed(1)}px)`;
  }

  render() {
    if (!this._open || !this._slides.length) return nothing;
    const s = this._slides[this._ix];
    const last = this._slides.length - 1;
    return html`
      <div class="stage" @click=${(e) => { if (!e.target.closest('button')) this.#step(1); }}>
        <button class="x" title="Close slideshow (Esc)" aria-label="Close slideshow" @click=${() => this.close()}>×</button>
        <button class="nav prev" title="Previous slide (←)" aria-label="Previous slide"
          ?disabled=${this._ix === 0} @click=${() => this.#step(-1)}>‹</button>
        <button class="nav next" title="Next slide (→)" aria-label="Next slide"
          ?disabled=${this._ix === last} @click=${() => this.#step(1)}>›</button>
        ${s.img ? html`<img alt="" src=${s.img}>` : html`<div class="noimg">No board yet</div>`}
      </div>
      <div class="bottom">
        <div class="prog"><i style="width:${((this._ix + 1) / this._slides.length) * 100}%"></i></div>
        <div class="txt">
          <div class="left">
            <div class="scene">${s.label}${s.cap ? ' · ' + s.cap : ''}</div>
            <div class="lines" style="font-size:${this.#lineSize(s.lines)}">
              ${(s.lines || []).map((l) => html`<div class="l-${l.type}">${l.text}</div>`)}
            </div>
          </div>
          <div class="rightcol"><span class="n">${this._ix + 1} / ${this._slides.length}</span></div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-slideshow', PandemoniumSlideshow);

'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { CONTENT_TYPES } from '../../fountain/blocks.js';

// Fullscreen playback: image on top, the linked (or nearest) script excerpt
// in the bottom fifth. One instance at app-root, opened via
// `pandemonium-open-slideshow`.
export class PandemoniumSlideshow extends LitElement {
  static properties = { _open: { state: true }, _slides: { state: true }, _ix: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:85;background:#000;display:none;flex-direction:column;font-family:var(--sans)}
    :host([data-open]){display:flex}
    .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
    .stage img{max-width:100%;max-height:100%;object-fit:contain;display:block}
    .noimg{width:min(58%,640px);aspect-ratio:16/9;background:var(--ph);display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px;letter-spacing:.08em;text-transform:uppercase;border-radius:2px}
    .x{position:absolute;top:14px;right:16px;color:#fff;background:rgba(255,255,255,.14);width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:0;border-radius:50%;cursor:pointer}
    .x:hover{background:rgba(255,255,255,.28)}
    .bottom{flex:none;height:30%;min-height:200px;background:var(--bg);display:flex;flex-direction:column}
    .prog{height:3px;background:var(--panel)}
    .prog i{display:block;height:100%;background:var(--act)}
    .txt{flex:1;min-height:0;display:flex;gap:24px;align-items:flex-start;padding:16px 26px;overflow:hidden}
    .txt .left{flex:1;min-width:0;height:100%;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
    .scene{margin-bottom:6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    .lines{
      font-family:var(--mono);font-size:34px;line-height:1.35;color:var(--ink);
      white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;
    }
    .rightcol{flex:none;text-align:right;color:var(--mut);font-size:11px;display:flex;flex-direction:column;gap:4px}
    .rightcol .n{color:var(--ui);font-weight:500;font-size:12px}
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
    const excerpt = (sc) => {
      const parts = [];
      for (let bi = Math.max(0, sc.start); bi <= sc.end && bi < parsed.blocks.length; bi++) {
        const b = parsed.blocks[bi];
        if (CONTENT_TYPES[b.type] && b.plain) {
          parts.push(b.plain);
          if (parts.join(' ').length > 340) break;
        }
      }
      return parts.join('\n');
    };
    const slides = [];
    scenes.forEach((sc, ix) => {
      if (sc.end < sc.start && !byScene[ix].length) return;
      const label = (sc.pre ? 'Opening' : 'Sc ' + sc.label) + ' · ' + sc.name;
      if (!byScene[ix].length) { slides.push({ img: null, label, text: excerpt(sc) || sc.name }); return; }
      byScene[ix].forEach((o) => {
        const t = o.bd.anchor.parts.map((p) => p.q).join('\n');
        slides.push({ img: o.bd.img, cap: o.bd.caption, label, text: t || excerpt(sc) });
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

  render() {
    if (!this._open || !this._slides.length) return nothing;
    const s = this._slides[this._ix];
    return html`
      <div class="stage" @click=${(e) => { if (!e.target.closest('.x')) this.#step(1); }}>
        <button class="x" title="Close" @click=${() => this.close()}>×</button>
        ${s.img ? html`<img alt="" src=${s.img}>` : html`<div class="noimg">No board yet</div>`}
      </div>
      <div class="bottom">
        <div class="prog"><i style="width:${((this._ix + 1) / this._slides.length) * 100}%"></i></div>
        <div class="txt">
          <div class="left">
            <div class="scene">${s.label}${s.cap ? ' · ' + s.cap : ''}</div>
            <div class="lines">${s.text || ''}</div>
          </div>
          <div class="rightcol"><span class="n">${this._ix + 1} / ${this._slides.length}</span><span>arrows to move · esc to close</span></div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-slideshow', PandemoniumSlideshow);

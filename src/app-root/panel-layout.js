'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { clamp } from '../utils/format.js';
import '../components/boards/boards-panel.js';
import '../components/research/research-panel.js';
import '../components/editor/script-panel.js';

// Grid layout for the panels.
//  - 'everything'/'single' render fully-free slots (notes.md point e): each
//    slot shows whatever panel type ui.slots / ui.singleSlot names, chosen
//    from its header dropdown, duplicates allowed.
//  - 'split' keeps the original script + (boards|research) pairing driven by
//    the Boards/Research toggle.
// The gaps between panels are real grid tracks (the ".div" cells), so they
// double as drag handles that resize the panels (notes.md point f) -- the
// column/row fractions live in ui (eCol/eRow/sCol) and are applied as inline
// grid templates in #applyTemplates(), which beats the CSS defaults below.
export class PandemoniumPanelLayout extends LitElement {
  static properties = {
    view: { type: String, reflect: true }, // 'everything' | 'split' | 'single'
    split: { type: String, reflect: true }, // 'boards' | 'research'
  };

  static styles = css`
    :host{flex:1;min-height:0;display:grid;padding:0 22px 18px;position:relative}
    .slot{display:flex;flex-direction:column;min-height:0;min-width:0}

    /* Divider tracks: the visual gap plus a grab handle. */
    .div{position:relative;z-index:2}
    .div::after{content:"";position:absolute;background:transparent;border-radius:3px;transition:background .12s}
    .div:hover::after,.div.dragging::after{background:var(--ph)}
    .div.v{cursor:col-resize}
    .div.v::after{inset:0 9px}
    .div.h{cursor:row-resize}
    .div.h::after{inset:9px 0}

    :host([view=everything]){grid-template-columns:5fr 24px 7fr;grid-template-rows:1fr 24px 236px;
      grid-template-areas:"s0 vdiv s1" "hdiv hdiv hdiv" "s2 s2 s2"}
    :host([view=everything]) .s0{grid-area:s0}
    :host([view=everything]) .s1{grid-area:s1}
    :host([view=everything]) .s2{grid-area:s2}
    :host([view=everything]) .vdiv{grid-area:vdiv}
    :host([view=everything]) .hdiv{grid-area:hdiv}

    :host([view=split]){grid-template-columns:1fr 24px 1fr;grid-template-areas:"side vdiv script"}
    :host([view=split]) .side{grid-area:side}
    :host([view=split]) .script{grid-area:script}
    :host([view=split]) .vdiv{grid-area:vdiv}

    :host([view=single]){grid-template-columns:1fr;grid-template-areas:"s0"}
    :host([view=single]) .s0{grid-area:s0}

    @media (max-width:900px){
      :host([view=everything]),:host([view=split]){
        grid-template-columns:1fr!important;grid-template-rows:auto!important;display:flex;flex-direction:column;overflow:auto;gap:16px;
      }
      .div{display:none}
      .slot{min-height:280px;flex:none}
    }
  `;

  #narrow = () => matchMedia('(max-width:900px)').matches;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._onResize = () => this.#applyTemplates();
  }

  connectedCallback() { super.connectedCallback(); addEventListener('resize', this._onResize); }
  disconnectedCallback() { removeEventListener('resize', this._onResize); this.#endDrag(); super.disconnectedCallback(); }

  updated() { this.#applyTemplates(); }

  #applyTemplates() {
    const ui = this._store.ui;
    if (!ui || this.#narrow()) { this.style.gridTemplateColumns = ''; this.style.gridTemplateRows = ''; return; }
    if (this.view === 'everything') {
      this.style.gridTemplateColumns = `${ui.eCol}fr 24px ${1 - ui.eCol}fr`;
      this.style.gridTemplateRows = `${ui.eRow}fr 24px ${1 - ui.eRow}fr`;
    } else if (this.view === 'split') {
      this.style.gridTemplateColumns = `${ui.sCol}fr 24px ${1 - ui.sCol}fr`;
      this.style.gridTemplateRows = '';
    } else {
      this.style.gridTemplateColumns = '';
      this.style.gridTemplateRows = '';
    }
  }

  // Drag a divider. `key` is which ui fraction it controls; `axis` is 'x'|'y'.
  // The live drag writes the grid template straight onto this element (no
  // store churn / no editor re-render per pixel); the final value is committed
  // to ui once on release, where #applyTemplates() picks it back up.
  #startDrag(e, key, axis) {
    e.preventDefault();
    const track = e.currentTarget;
    track.classList.add('dragging');
    const rect = this.getBoundingClientRect();
    const move = (ev) => {
      const f = axis === 'x'
        ? (ev.clientX - rect.left - 22) / (rect.width - 44 - 24)
        : (ev.clientY - rect.top) / (rect.height - 18 - 24);
      const val = clamp(f, 0.15, 0.85);
      this._dragVal = val;
      if (axis === 'x') this.style.gridTemplateColumns = `${val}fr 24px ${1 - val}fr`;
      else this.style.gridTemplateRows = `${val}fr 24px ${1 - val}fr`;
    };
    const up = () => {
      this.#endDrag();
      track.classList.remove('dragging');
      if (this._dragVal != null) this._store.store.setUI({ [key]: this._dragVal });
      this._dragVal = null;
    };
    this._dragMove = move; this._dragUp = up;
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  #endDrag() {
    if (this._dragMove) removeEventListener('pointermove', this._dragMove);
    if (this._dragUp) removeEventListener('pointerup', this._dragUp);
    this._dragMove = this._dragUp = null;
  }

  #panel(type, slotId) {
    if (type === 'boards') return html`<pandemonium-boards-panel .slotId=${slotId}></pandemonium-boards-panel>`;
    if (type === 'research') return html`<pandemonium-research-panel .slotId=${slotId}></pandemonium-research-panel>`;
    return html`<pandemonium-script-panel .slotId=${slotId}></pandemonium-script-panel>`;
  }

  render() {
    const ui = this._store.ui;
    if (!ui) return html``;

    if (this.view === 'single') {
      return html`<div class="slot s0">${this.#panel(ui.singleSlot || 'script', 'single')}</div>`;
    }
    if (this.view === 'split') {
      const side = ui.split === 'research'
        ? html`<pandemonium-research-panel></pandemonium-research-panel>`
        : html`<pandemonium-boards-panel></pandemonium-boards-panel>`;
      return html`
        <div class="slot side">${side}</div>
        <div class="div v vdiv" @pointerdown=${(e) => this.#startDrag(e, 'sCol', 'x')}></div>
        <div class="slot script"><pandemonium-script-panel></pandemonium-script-panel></div>
      `;
    }
    const slots = ui.slots || ['boards', 'script', 'research'];
    return html`
      <div class="slot s0">${this.#panel(slots[0], 0)}</div>
      <div class="div v vdiv" @pointerdown=${(e) => this.#startDrag(e, 'eCol', 'x')}></div>
      <div class="slot s1">${this.#panel(slots[1], 1)}</div>
      <div class="div h hdiv" @pointerdown=${(e) => this.#startDrag(e, 'eRow', 'y')}></div>
      <div class="slot s2">${this.#panel(slots[2], 2)}</div>
    `;
  }
}

customElements.define('pandemonium-panel-layout', PandemoniumPanelLayout);

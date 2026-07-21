'use strict';

import { LitElement, html, css } from 'lit';
import { clamp } from '../../utils/format.js';

// One instance at app-root, opened via a bubbling `pandemonium-open-menu`
// event carrying {anchor: HTMLElement, items: [{label, selected, danger, fn}]}.
// Positioned off the anchor's own getBoundingClientRect() -- a public DOM
// method, safe to call across shadow-root boundaries -- so callers never
// need to pre-compute coordinates for a simple popover like this one.
export class PdMenu extends LitElement {
  static properties = { _open: { state: true }, _items: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    .pop{
      position:fixed;background:var(--ui);color:#fff;border-radius:var(--r);
      display:flex;flex-direction:column;min-width:150px;padding:3px;gap:2px;
      pointer-events:auto;font-family:var(--sans);
    }
    button{
      font:inherit;color:#fff;font-size:11px;font-weight:500;padding:4px 9px;
      white-space:nowrap;text-align:left;background:none;border:0;border-radius:2px;cursor:pointer;
    }
    button:hover{background:rgba(255,255,255,.16)}
    /* The current choice is carried by a pink fill rather than a trailing
       check, so the labels stay a clean column. */
    button.on,button.on:hover{background:var(--res);color:#fff}
    button.danger{color:#ffb3c1}
  `;

  constructor() {
    super();
    this._open = false;
    this._items = [];
    this._anchor = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocDown = (e) => {
      if (!this._open) return;
      if (this._anchor && e.composedPath().includes(this._anchor)) return;
      if (e.composedPath().includes(this)) return;
      this.close();
    };
    document.addEventListener('mousedown', this._onDocDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    super.disconnectedCallback();
  }

  open({ anchor, items }) {
    if (this._open && this._anchor === anchor) { this.close(); return; }
    this._anchor = anchor;
    this._items = items;
    this._open = true;
    this.updateComplete.then(() => this.#position());
  }

  close() {
    this._open = false;
    this._anchor = null;
  }

  #position() {
    if (!this._anchor) return;
    const pop = this.renderRoot.querySelector('.pop');
    if (!pop) return;
    const r = this._anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    this._x = clamp(r.left, 8, innerWidth - w - 8);
    this._y = clamp(r.bottom + 6, 8, innerHeight - h - 8);
  }

  #pick(item) {
    this.close();
    item.fn();
  }

  render() {
    if (!this._open) return html``;
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        ${this._items.map((it) => html`<button
          class="${it.danger ? 'danger' : ''} ${it.selected ? 'on' : ''}"
          @click=${() => this.#pick(it)}>${it.label}</button>`)}
      </div>
    `;
  }
}

customElements.define('pd-menu', PdMenu);

'use strict';

import { LitElement, html, css } from 'lit';
import { clamp } from '../../utils/format.js';

// One instance at app-root, opened via a bubbling `pandemonium-open-menu`
// event carrying either {anchor: HTMLElement, items} for a dropdown positioned
// off the anchor's own getBoundingClientRect() -- a public DOM method, safe to
// call across shadow-root boundaries -- or {x, y, items} for a menu positioned
// at a raw viewport point (the right-click context menus in panel-layout.js
// and pandemonium-app.js use this form, since there is no anchor element for a
// cursor position). `items` entries are either {label, selected, danger, fn}
// or {divider: true} for a separator line, or {swatches: [{color, label,
// selected, fn}]} for a single row of round colour buttons. Pass variant:'pills' for the
// "link to" menu (Figma 101-2170): a bare stack of solid colored pills where
// each item's `accent` is its fill color.
export class PdMenu extends LitElement {
  static properties = { _open: { state: true }, _items: { state: true }, _x: { state: true }, _y: { state: true }, _variant: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    /* Opens by dropping 4px into place while it fades in: fast (--dur-1),
       because a menu is waited on, and a slow one feels like lag. */
    @keyframes menu-in{from{opacity:0;transform:translateY(-4px) scale(.98)}}
    .pop{
      animation:menu-in var(--dur-1) var(--ease-out);transform-origin:top left;
      position:fixed;background:var(--overlay);color:var(--overlay-ink);border-radius:var(--r);
      display:flex;flex-direction:column;min-width:150px;padding:3px;gap:2px;
      pointer-events:auto;font-family:var(--sans);
    }
    button{
      font:inherit;color:var(--overlay-ink);font-size:11px;font-weight:500;padding:4px 9px;
      white-space:nowrap;text-align:left;background:none;border:0;border-radius:2px;cursor:pointer;
    }
    button:hover{background:rgba(255,255,255,.16)}
    /* The current choice is carried by a pink fill rather than a trailing
       check, so the labels stay a clean column. */
    button.on,button.on:hover{background:var(--res);color:#fff}
    button.danger{color:#ffb3c1}
    /* A swatch row: {swatches:[...]} becomes one row of round colour buttons
       rather than six labelled rows. Colour is the one choice where the word
       for it is worth less than the thing itself, and six words down a menu
       cost six lines to say what one row says at a glance. */
    .swatches{display:flex;gap:7px;padding:4px 6px 6px}
    .swatches button{
      width:18px;height:18px;flex:none;padding:0;border:0;border-radius:50%;cursor:pointer;
      transition:transform .1s;
    }
    .swatches button:hover{transform:scale(1.18)}
    /* The chosen one wears a ring the colour of the menu it sits on, then a
       light one outside it, so the mark reads on every swatch in the row. */
    .swatches button.on{box-shadow:0 0 0 2px var(--overlay),0 0 0 3.5px rgba(255,255,255,.92)}
    .sep{height:1px;margin:3px 6px;background:rgba(255,255,255,.16);flex:none}
    /* Pills variant: the "link to" menu (Figma node 101-2170) is a bare,
       right-aligned stack of solid colored pills (storyboard / reference /
       sound) rather than a dark dropdown. The container drops its own chrome
       and each item is a full-fill pill in its accent color. */
    .pop.pills{background:transparent;padding:0;gap:5px;min-width:120px;align-items:stretch}
    .pop.pills button{
      color:#fff;font-size:13px;font-weight:500;line-height:1;text-align:center;
      padding:8px 14px;border-radius:20px;
    }
    .pop.pills button:hover{filter:brightness(1.07)}
  `;

  constructor() {
    super();
    this._open = false;
    this._items = [];
    this._anchor = null;
    this._point = null;
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

  open({ anchor, x, y, items, variant }) {
    if (anchor && this._open && this._anchor === anchor) { this.close(); return; }
    this._anchor = anchor || null;
    this._point = anchor ? null : { x, y };
    this._items = items;
    this._variant = variant || null;
    this._open = true;
    this.updateComplete.then(() => this.#position());
  }

  close() {
    this._open = false;
    this._anchor = null;
    this._point = null;
    this._variant = null;
  }

  #position() {
    const pop = this.renderRoot.querySelector('.pop');
    if (!pop) return;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    if (this._anchor) {
      const r = this._anchor.getBoundingClientRect();
      this._x = clamp(r.left, 8, innerWidth - w - 8);
      this._y = clamp(r.bottom + 6, 8, innerHeight - h - 8);
    } else if (this._point) {
      this._x = clamp(this._point.x, 8, innerWidth - w - 8);
      this._y = clamp(this._point.y, 8, innerHeight - h - 8);
    }
  }

  #pick(item) {
    this.close();
    item.fn();
  }

  render() {
    if (!this._open) return html``;
    if (this._variant === 'pills') {
      return html`
        <div class="pop pills" style="left:${this._x || 0}px;top:${this._y || 0}px">
          ${this._items.map((it) => html`<button style="background:${it.accent}"
            @click=${() => this.#pick(it)}>${it.label}</button>`)}
        </div>
      `;
    }
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        ${this._items.map((it) => {
          if (it.divider) return html`<div class="sep"></div>`;
          if (it.swatches) {
            return html`<div class="swatches">${it.swatches.map((sw) => html`<button
              class=${sw.selected ? 'on' : ''} style="background:${sw.color}" title=${sw.label || ''}
              @click=${() => this.#pick(sw)}></button>`)}</div>`;
          }
          return html`<button
            class="${it.danger ? 'danger' : ''} ${it.selected ? 'on' : ''}"
            @click=${() => this.#pick(it)}>${it.label}</button>`;
        })}
      </div>
    `;
  }
}

customElements.define('pd-menu', PdMenu);

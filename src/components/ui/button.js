'use strict';

import { LitElement, html, css } from 'lit';

// Phase 1: matches the original flat `.btn` look exactly (parity migration).
// Phase 2 replaces this stylesheet with the Figma "Button-Standard" treatment
// (white fill, bordered, drop-shadow) without touching any call site, since
// every button in the app already goes through this one component.
export class PdButton extends LitElement {
  static properties = {
    variant: { type: String, reflect: true }, // 'default' | 'dark' | 'act' | 'ghost'
    disabled: { type: Boolean, reflect: true },
    title: { type: String },
  };

  static styles = css`
    :host{display:inline-flex}
    button{
      font:inherit;
      height:24px;
      padding:0 10px;
      background:var(--panel);
      color:var(--ui);
      font-size:11px;
      font-weight:500;
      display:inline-flex;
      align-items:center;
      gap:6px;
      white-space:nowrap;
      border:0;
      border-radius:var(--r);
      cursor:pointer;
      font-family:var(--sans);
    }
    button:hover{background:var(--ph)}
    button:disabled{opacity:.5;cursor:default;background:var(--panel)}
    :host([variant=dark]) button{background:var(--ui);color:#fff}
    :host([variant=dark]) button:hover{background:var(--ink)}
    :host([variant=act]) button{background:var(--act);color:var(--ink)}
    :host([variant=act]) button:hover{background:#f0d06d}
    :host([variant=ghost]) button{background:transparent;color:var(--mut)}
    :host([variant=ghost]) button:hover{color:var(--ui);background:var(--panel)}
  `;

  constructor() {
    super();
    this.variant = 'default';
    this.disabled = false;
  }

  render() {
    return html`<button
      part="button"
      ?disabled=${this.disabled}
      title=${this.title || ''}
      @click=${(e) => { if (this.disabled) { e.stopPropagation(); e.preventDefault(); } }}
    ><slot></slot></button>`;
  }
}

customElements.define('pd-button', PdButton);

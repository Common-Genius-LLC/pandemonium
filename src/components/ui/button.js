'use strict';

import { LitElement, html, css } from 'lit';

// Figma "Button-Standard-Component" (node 21:69). The resting look is the
// component's Property 1=Default (white fill, #b8b8b8 border, lift shadow) and
// :active is its Property 1=Variant2 (border darkens, the lift is traded for an
// inset shadow). Every button in the app goes through this one component, so
// the semantic variants keep that same shell and press behavior and only swap
// the fill. `ghost` is the one opt-out: it is a quiet inline text action
// (Delete, and similar) that would read as a second primary button if it wore
// the shell.
export class PdButton extends LitElement {
  static properties = {
    variant: { type: String, reflect: true }, // 'default' | 'dark' | 'act' | 'ghost' | 'pink'
    disabled: { type: Boolean, reflect: true },
    title: { type: String },
  };

  static styles = css`
    :host{display:inline-flex}
    button{
      box-sizing:border-box;
      font-family:var(--sans);
      height:24px;
      padding:5px 10px;
      font-size:12px;
      line-height:12px;
      font-weight:500;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      white-space:nowrap;
      color:var(--ui);
      background:#fff;
      border:1px solid var(--btn-line);
      border-radius:var(--r);
      box-shadow:0 1px 1.25px rgba(0,0,0,.25);
      cursor:pointer;
    }
    button:hover{background:var(--btn-hi)}
    button:active{border-color:var(--btn-line-on);box-shadow:inset 0 1px 4.2px 0 #000}
    button:disabled{opacity:.5;cursor:default}
    /* A disabled button must not look pressed when it is clicked. */
    button:disabled:active{border-color:var(--btn-line);box-shadow:0 1px 1.25px rgba(0,0,0,.25)}

    /* Filled variants. The border tracks the fill instead of staying #b8b8b8,
       which only reads as an edge against white. */
    :host([variant=dark]) button{background:var(--ui);color:#fff;border-color:rgba(0,0,0,.22)}
    :host([variant=dark]) button:hover{background:var(--ink)}
    :host([variant=act]) button{background:var(--act);color:var(--ink);border-color:rgba(0,0,0,.22)}
    :host([variant=act]) button:hover{background:#f0d06d}
    :host([variant=pink]) button{background:var(--res);color:#fff;border-color:rgba(0,0,0,.22)}
    :host([variant=pink]) button:hover{background:#b01286}

    :host([variant=ghost]) button{
      background:transparent;color:var(--mut);
      border-color:transparent;box-shadow:none;
    }
    :host([variant=ghost]) button:hover{color:var(--ui);background:var(--panel)}
    :host([variant=ghost]) button:active{background:var(--ph);border-color:transparent;box-shadow:none}
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

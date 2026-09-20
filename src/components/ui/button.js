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
    // A square, label-less button for a single icon/glyph (e.g. an inline
    // SVG slotted in), rather than the padded pill a text label needs.
    icon: { type: Boolean, reflect: true },
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
      background:var(--btn-bg);
      /* A fainter hairline: the fill and the shadow already say it is a
         button, and a full-strength grey outline read as heavy. */
      border:1px solid color-mix(in srgb, var(--btn-line) 45%, transparent);
      /* Pill-rounded, the same radius as every other interactive control in
         the app now (board-card.js .pill, the Final/Reference switch): one
         consistent shape for anything clickable, decoupled from --r (which
         other, non-button chrome still uses for its own subtler rounding). */
      border-radius:20px;
      box-shadow:0 1px 1.25px rgba(0,0,0,.25);
      cursor:pointer;
    }
    button:hover{background:var(--btn-hi)}
    button:active{border-color:color-mix(in srgb, var(--btn-line-on) 60%, transparent);box-shadow:inset 0 1px 4.2px 0 #000}
    button:disabled{opacity:.5;cursor:default}
    /* A disabled button must not look pressed when it is clicked. */
    button:disabled:active{border-color:color-mix(in srgb, var(--btn-line) 45%, transparent);box-shadow:0 1px 1.25px rgba(0,0,0,.25)}

    /* Filled variants. The border tracks the fill instead of staying #b8b8b8,
       which only reads as an edge against white. */
    :host([variant=dark]) button{background:var(--overlay);color:var(--overlay-ink);border-color:rgba(0,0,0,.1)}
    :host([variant=dark]) button:hover{background:var(--ui)}
    :host([variant=act]) button{background:var(--act);color:var(--act-ink);border-color:rgba(0,0,0,.1)}
    :host([variant=act]) button:hover{background:var(--act-hi)}
    :host([variant=pink]) button{background:var(--res);color:#fff;border-color:rgba(0,0,0,.1)}
    :host([variant=pink]) button:hover{background:var(--res-hi)}

    :host([variant=ghost]) button{
      background:transparent;color:var(--mut);
      border-color:transparent;box-shadow:none;
    }
    :host([variant=ghost]) button:hover{color:var(--ui);background:var(--panel)}
    :host([variant=ghost]) button:active{background:var(--ph);border-color:transparent;box-shadow:none}

    /* Icon buttons: a 28px square holding an 18px glyph (was 24 and 14, which
       left the glyph small enough to need squinting at). */
    :host([icon]) button{width:28px;height:28px;padding:5px;gap:0}
    :host([icon]) ::slotted(svg){width:18px;height:18px;fill:currentColor}
  `;

  constructor() {
    super();
    this.variant = 'default';
    this.disabled = false;
    this.icon = false;
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

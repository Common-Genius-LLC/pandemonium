'use strict';

import { LitElement, html, css } from 'lit';
import { dispatch } from '../../utils/events.js';
import { placeBubble } from './confirm-place.js';

// Figma "Delete Dialogue box" (node 144-423): a small black bubble whose pointer
// touches the control that asked, holding a question and Cancel / Delete. It
// stands in for the browser's own confirm(), which is a system window the app
// cannot style, cannot anchor to what was clicked, and blocks the page.
//
// The parent renders it only while a question is open and hands it the control
// (`anchor`); it says nothing about what is being confirmed. It answers with
// `pd-confirm` or `pd-dismiss` and leaves closing to the parent. Dismissing on a
// press elsewhere and on Escape is the parent's job too, since it already
// decides what those keys and presses mean for the surface underneath.
//
// The shape is the Figma vector as a mask, so its fill is a token and follows the
// theme (the same way panel-layout.js draws the corner handles).
export class PdConfirmBubble extends LitElement {
  static properties = {
    anchor: { attribute: false }, // the element the pointer touches
    question: { type: String },
    confirmLabel: { type: String, attribute: 'confirm-label' },
    busy: { type: Boolean, reflect: true }, // the answer is on its way: no second click
  };

  static styles = css`
    :host{display:contents}
    @keyframes bubble-in{from{opacity:0;transform:scale(.94)}}
    .bubble{
      --shape:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 213.237 102.707' preserveAspectRatio='none'%3E%3Cpath d='M84.2467 13.7732H21C9.40202 13.7732 0 23.1752 0 34.7731V81.7072C0 93.3051 9.40203 102.707 21 102.707H192.237C203.835 102.707 213.237 93.3052 213.237 81.7072V34.7732C213.237 23.1752 203.835 13.7732 192.237 13.7732H126.705C122.992 13.7732 119.431 12.2982 116.805 9.67266L108.304 1.17157C106.742 -0.390523 104.209 -0.390525 102.647 1.17157L94.1462 9.67266C91.5207 12.2982 87.9597 13.7732 84.2467 13.7732Z' fill='black'/%3E%3C/svg%3E");
      /* Room above the content is the pointer plus the box's own padding; the
         flipped bubble swaps the two so the pointer stays on the outside. */
      --pad-far:29.47px;
      --pad-near:15.24px;
      position:fixed;z-index:1;isolation:isolate;box-sizing:border-box;
      width:213.237px;height:102.707px;
      padding:var(--pad-far) 16.62px var(--pad-near);
      display:flex;flex-direction:column;align-items:center;gap:17px;
      color:var(--overlay-ink);font-family:var(--sans);
      transform-origin:105.475px 0;
      animation:bubble-in var(--dur-1) var(--ease-out);
    }
    .bubble.above{
      padding:var(--pad-near) 16.62px var(--pad-far);
      transform-origin:105.475px 100%;
    }
    /* Flat, no border and no shadow: solid fill only. */
    .shape{
      position:absolute;inset:0;z-index:-1;background:var(--confirm);
      -webkit-mask:var(--shape) 0 0/100% 100% no-repeat;
      mask:var(--shape) 0 0/100% 100% no-repeat;
    }
    .above .shape{transform:scaleY(-1)}
    .q{margin:0;width:100%;height:17px;font-size:14px;line-height:17px;font-weight:400;text-align:center}
    .row{display:flex;gap:10px;width:100%}
    button{
      flex:1;min-width:0;height:24px;padding:0 8px;border:0;border-radius:43px;
      font:inherit;font-size:14px;line-height:16px;font-weight:500;letter-spacing:-.14px;
      color:var(--overlay-ink);white-space:nowrap;cursor:pointer;
      transition:background var(--dur-1) var(--ease-out),filter var(--dur-1) var(--ease-out);
    }
    /* The design's grey at 20% over black is a light film; a film of the ink
       colour reads the same on either theme's bubble. */
    .cancel{background:color-mix(in srgb, var(--overlay-ink) 16%, transparent)}
    .cancel:hover{background:color-mix(in srgb, var(--overlay-ink) 26%, transparent)}
    .ok{background:var(--confirm-danger)}
    .ok:hover{filter:brightness(1.12)}
    button:active{filter:brightness(.9)}
    button:disabled{opacity:.5;cursor:default;filter:none}
  `;

  constructor() {
    super();
    this.anchor = null;
    this.question = 'Are you sure?';
    this.confirmLabel = 'Delete';
    this.busy = false;
    this._place = null;
    // The pointer was aimed at where the control WAS; after a resize it is not
    // there any more, and following it is not worth the machinery. Close.
    this._onResize = () => dispatch(this, 'pd-dismiss', {});
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this._onResize);
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._onResize);
    super.disconnectedCallback();
  }

  willUpdate(changed) {
    if (changed.has('anchor')) {
      this._place = this.anchor
        ? placeBubble(this.anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
        : null;
    }
  }

  firstUpdated() {
    // Cancel takes focus: Enter on a question about deleting something should
    // never be the thing that deletes it.
    const cancel = this.renderRoot.querySelector('.cancel');
    if (cancel) cancel.focus({ preventScroll: true });
  }

  render() {
    const p = this._place;
    if (!p) return html``;
    return html`
      <div class="bubble ${p.side}" role="alertdialog" aria-label=${this.question}
        style="left:${p.left}px;top:${p.top}px">
        <div class="shape"></div>
        <p class="q">${this.question}</p>
        <div class="row">
          <button class="cancel" ?disabled=${this.busy}
            @click=${() => dispatch(this, 'pd-dismiss', {})}>Cancel</button>
          <button class="ok" ?disabled=${this.busy}
            @click=${() => dispatch(this, 'pd-confirm', {})}>${this.confirmLabel}</button>
        </div>
      </div>
    `;
  }
}

customElements.define('pd-confirm-bubble', PdConfirmBubble);

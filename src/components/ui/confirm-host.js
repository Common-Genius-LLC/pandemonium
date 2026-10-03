// The app's one confirmation question. Lives at app-root (pandemonium-app.js)
// beside the toast and the menu, and answers the `pandemonium-confirm` events
// askConfirm() sends (confirm.js).
//
// It owns exactly what a question has to own beyond its own shape: how it is
// put away without being answered. Escape, a press anywhere else, and a scroll
// all mean "never mind", and Escape is swallowed so the surface underneath (an
// open source closes on Escape, a dialog too) does not act on the same press.
// A scroll dismisses rather than follows, because the bubble is fixed to the
// viewport and its pointer was aimed at where the control was.
'use strict';

import { LitElement, html, css } from 'lit';
import './confirm-bubble.js';

export class PdConfirmHost extends LitElement {
  static properties = { _req: { state: true } };

  // Above every surface that can ask one (a dialog is 88, the slideshow 85,
  // the toast 90): a question must never open behind the thing it is about.
  // The layer itself is transparent to the pointer, so the press that puts the
  // question away still reaches whatever it was aimed at; only the bubble
  // takes clicks (pointer-events inherits through a shadow boundary).
  static styles = css`
    :host{position:fixed;inset:0;z-index:95;pointer-events:none}
    pd-confirm-bubble{pointer-events:auto}
  `;

  constructor() {
    super();
    this._req = null;
    // Capture, so a question is put away before the press or the key reaches
    // whatever is underneath it.
    // A press elsewhere ONLY puts the question away: it does not also act on
    // whatever it landed on. While a question about deleting something is up,
    // the next press is far more likely to mean "no" than to mean the control
    // it happens to be over (the same rule the account dialog already follows).
    this._onDown = (e) => {
      if (!this._req) return;
      const path = e.composedPath();
      if (path.some((n) => n && n.localName === 'pd-confirm-bubble')) return;
      e.stopPropagation();
      this.#answer(false);
    };
    this._onKey = (e) => {
      if (!this._req || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.#answer(false);
    };
    this._onScroll = () => { if (this._req) this.#answer(false); };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('mousedown', this._onDown, true);
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDown, true);
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('scroll', this._onScroll, true);
    super.disconnectedCallback();
  }

  // `detail` is {anchor, question, confirmLabel, respond}. A second question
  // arriving while one is up answers the first with "no": two questions at once
  // would be two bubbles pointing at two things, and the writer can only have
  // meant the one they just asked for.
  ask(detail) {
    if (!detail || typeof detail.respond !== 'function') return;
    detail.handled = true;
    if (this._req) this._req.respond(false);
    this._req = detail;
  }

  #answer(v) {
    const req = this._req;
    this._req = null;
    if (req) req.respond(v);
  }

  render() {
    const req = this._req;
    if (!req) return html``;
    return html`<pd-confirm-bubble
      .anchor=${req.anchor || null}
      question=${req.question || 'Are you sure?'}
      confirm-label=${req.confirmLabel || 'Delete'}
      @pd-confirm=${() => this.#answer(true)}
      @pd-dismiss=${() => this.#answer(false)}></pd-confirm-bubble>`;
  }
}

customElements.define('pd-confirm-host', PdConfirmHost);

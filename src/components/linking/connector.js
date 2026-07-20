'use strict';

import { LitElement, html, css, svg } from 'lit';
import { StoreController } from '../../state/store-controller.js';

// Draws the animated line between a script highlight and its paired
// research highlight. Doesn't reach into either panel's shadow DOM itself;
// script-panel and research-reader each run their own RAF loop while
// ui.pair is set and report `{side, rect}` (plain viewport coordinates, or
// rect:null if their side currently has nothing visible to point at) via
// bubbling `pandemonium-connector-point` events. This is what a Phase 3
// CodeMirror-based script editor can plug into unchanged, since it also
// just needs to report a rect from wherever its own selection API says the
// highlight is.
export class PandemoniumConnector extends LitElement {
  static styles = css`
    :host{position:fixed;inset:0;z-index:65;pointer-events:none;display:block}
    svg{width:100%;height:100%;display:block}
  `;

  #script = null;
  #research = null;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this._onPoint = (e) => {
      const { side, rect } = e.detail;
      if (side === 'script') this.#script = rect;
      else this.#research = rect;
      this.requestUpdate();
    };
    document.addEventListener('pandemonium-connector-point', this._onPoint);
  }

  disconnectedCallback() {
    document.removeEventListener('pandemonium-connector-point', this._onPoint);
    super.disconnectedCallback();
  }

  render() {
    const ui = this._store.ui;
    if (!ui || !ui.pair || !this.#script || !this.#research) return html``;
    const a = this.#script, b = this.#research;
    const mx = (a.x + b.x) / 2;
    const d = `M${a.x} ${a.y} C${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
    return html`<svg viewBox="0 0 ${innerWidth} ${innerHeight}">
      ${svg`<path d=${d} fill="none" stroke="#cf159e" stroke-width="2"/>
      <circle cx=${a.x} cy=${a.y} r="4" fill="#cf159e"/>
      <circle cx=${b.x} cy=${b.y} r="4" fill="#cf159e"/>`}
    </svg>`;
  }
}

customElements.define('pandemonium-connector', PandemoniumConnector);

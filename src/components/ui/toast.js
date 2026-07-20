'use strict';

import { LitElement, html, css } from 'lit';

// A single instance lives at app-root. Other components call
// `document.querySelector('pd-toast').show('message')` is avoidable --
// instead they dispatch a bubbling `pandemonium-toast` CustomEvent and
// pandemonium-app forwards it here, so nothing needs a direct reference.
export class PdToast extends LitElement {
  static properties = { _msg: { state: true }, _on: { state: true } };

  static styles = css`
    :host{
      position:fixed;left:50%;bottom:26px;transform:translateX(-50%);
      z-index:90;pointer-events:none;
    }
    .box{
      background:var(--ui);color:#fff;padding:7px 14px;border-radius:var(--r);
      font-size:12px;opacity:0;transition:opacity .18s;max-width:80vw;
      font-family:var(--sans);
    }
    .box.on{opacity:1}
  `;

  constructor() {
    super();
    this._msg = '';
    this._on = false;
  }

  show(msg) {
    this._msg = msg;
    this._on = true;
    clearTimeout(this._t);
    this._t = setTimeout(() => { this._on = false; }, 2400);
  }

  render() {
    return html`<div class="box ${this._on ? 'on' : ''}">${this._msg}</div>`;
  }
}

customElements.define('pd-toast', PdToast);

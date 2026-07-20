'use strict';

import { LitElement, html, css } from 'lit';
import { formStyles, chipStyles } from '../../styles/shared.js';
import './button.js';

// One instance lives at app-root. Any component opens it by dispatching
// `pandemonium-open-dialog` (see utils/events.js) with
// {title, body: TemplateResult, onOk(root), okLabel}; `root` passed to onOk
// is this dialog's renderRoot, so the caller reads its own form fields back
// out of the body it supplied -- same shape as the original openDialog().
export class PdDialog extends LitElement {
  static properties = { _open: { state: true }, _title: { state: true }, _body: { state: true }, _okLabel: { state: true } };

  static styles = [formStyles, chipStyles, css`
    :host{position:fixed;inset:0;z-index:88}
    :host(:not([data-open])){pointer-events:none}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;pointer-events:auto}
    .dlg{
      width:min(380px,92vw);background:var(--bg);border-radius:var(--r);padding:18px;
      display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow:auto;
      font-family:var(--sans);
    }
    h3{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin:0}
    .foot{display:flex;justify-content:flex-end;gap:6px;margin-top:4px}
  `];

  constructor() {
    super();
    this._open = false;
    this._onOk = null;
  }

  open({ title, body, onOk, okLabel }) {
    this._title = title;
    this._body = body;
    this._onOk = onOk || null;
    this._okLabel = okLabel || 'Save';
    this._open = true;
    this.setAttribute('data-open', '');
    this.updateComplete.then(() => {
      const f = this.renderRoot.querySelector('input, textarea, select');
      if (f) f.focus();
    });
  }

  close() {
    this._open = false;
    this._onOk = null;
    this.removeAttribute('data-open');
  }

  #ok() {
    const fn = this._onOk;
    const root = this.renderRoot;
    this.close();
    if (fn) fn(root);
  }

  render() {
    if (!this._open) return html``;
    return html`
      <div class="ov" @mousedown=${(e) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="dlg">
          <h3>${this._title}</h3>
          ${this._body}
          <div class="foot">
            <pd-button @click=${() => this.close()}>Cancel</pd-button>
            <pd-button variant="act" @click=${() => this.#ok()}>${this._okLabel}</pd-button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pd-dialog', PdDialog);

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
  static properties = {
    _open: { state: true }, _title: { state: true }, _body: { state: true },
    _okLabel: { state: true }, _width: { state: true },
    _bare: { state: true }, _doneOnly: { state: true },
  };

  static styles = [formStyles, chipStyles, css`
    :host{position:fixed;inset:0;z-index:88}
    :host(:not([data-open])){pointer-events:none}
    @keyframes dim-in{from{opacity:0}}
    @keyframes dlg-in{from{opacity:0;transform:translateY(6px) scale(.97)}}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;pointer-events:auto;
      animation:dim-in var(--dur-2) var(--ease-out)}
    .ov .dlg{animation:dlg-in var(--dur-2) var(--ease-out)}
    .dlg{
      width:min(var(--dlg-w,380px),92vw);background:var(--bg);border-radius:var(--r);padding:18px;
      display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow:auto;
      font-family:var(--sans);
    }
    /* A body that is already a designed object (the project card) gets no
       panel at all: no fill, no shadow, no footer. It carries its own
       drop shadow, and it commits as you go and on dismissal. The backdrop
       goes light to match, since the object's own shadow is what separates
       it from the page. */
    .ov.bare{background:rgba(0,0,0,.5)}
    /* overflow:visible is the point: the base panel scrolls its own content,
       which clipped the card's drop shadow flush at the panel bounds and drew
       exactly the box this variant exists to remove. */
    .dlg.bare{
      width:auto;max-width:92vw;max-height:none;overflow:visible;
      background:none;box-shadow:none;padding:0;
    }
    h3{font-size:14px;font-weight:500;color:var(--ink);margin:0}
    .foot{display:flex;justify-content:flex-end;gap:6px;margin-top:4px}
  `];

  constructor() {
    super();
    this._open = false;
    this._onOk = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) this.#dismiss(); };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  // `title` may be omitted for a body that names itself (the project card).
  // `width` overrides the default 380px for bodies that need more room.
  // `bare` drops the panel and the footer: dismissing IS the commit, so there
  // is no Cancel to offer and no Save to press.
  // `doneOnly` is for a body whose controls act the moment they are touched
  // (Settings): the footer keeps one button, Done, and loses Cancel, which
  // would promise a revert that nothing implements. Done rather than no
  // footer at all, because Escape and a backdrop click are real exits but
  // invisible ones, and a window should always show the way out of itself.
  open({ title, body, onOk, okLabel, width, bare, doneOnly }) {
    this._title = title;
    this._body = body;
    this._onOk = onOk || null;
    this._okLabel = okLabel || 'Save';
    this._width = width || null;
    this._bare = !!bare;
    this._doneOnly = !!doneOnly;
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

  // Clicking the backdrop or pressing Escape. A bare dialog has no Cancel, so
  // leaving it keeps what was entered rather than throwing it away.
  #dismiss() {
    if (this._bare) this.#ok();
    else this.close();
  }

  render() {
    if (!this._open) return html``;
    return html`
      <div class="ov ${this._bare ? 'bare' : ''}" @mousedown=${(e) => { if (e.target === e.currentTarget) this.#dismiss(); }}>
        <div class="dlg ${this._bare ? 'bare' : ''}" style=${this._width ? `--dlg-w:${this._width}px` : ''}>
          ${this._title ? html`<h3>${this._title}</h3>` : ''}
          ${this._body}
          ${this._bare ? '' : this._doneOnly ? html`
            <div class="foot">
              <pd-button variant="act" @click=${() => this.close()}>Done</pd-button>
            </div>` : html`
            <div class="foot">
              <pd-button @click=${() => this.close()}>Cancel</pd-button>
              <pd-button variant="act" @click=${() => this.#ok()}>${this._okLabel}</pd-button>
            </div>`}
        </div>
      </div>
    `;
  }
}

customElements.define('pd-dialog', PdDialog);

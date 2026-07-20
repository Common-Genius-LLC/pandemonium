'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';

export class PandemoniumResearchCard extends LitElement {
  static properties = { doc: { type: Object }, linkCount: { type: Number } };

  static styles = css`
    :host{display:block}
    .rcard{background:var(--panel);border-radius:var(--r);padding:10px;min-height:112px;display:flex;flex-direction:column;gap:6px;cursor:pointer}
    .rcard:hover{background:#e4e4e4}
    .rcard.kind-link{background:var(--pend)}
    .rcard.kind-link:hover{background:#cddcf6}
    .rt{font-weight:500;color:var(--ink);display:flex;gap:6px;align-items:baseline}
    .dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:none;margin-top:0}
    .snip{color:var(--mut);font-size:11px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex:1}
    .links{font-size:10px;color:var(--res);font-weight:500}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #click() {
    const store = this._store.store;
    const ui = store.ui;
    if (ui.linking && ui.linking.from === 'script') {
      store.addLink({ researchId: this.doc.id, sParts: ui.linking.parts, rParts: null });
      store.setUI({ linking: null });
      this.dispatchEvent(new CustomEvent('pandemonium-hide-linkbar', { bubbles: true, composed: true }));
      this.dispatchEvent(new CustomEvent('pandemonium-toast', { detail: { message: 'Linked.' }, bubbles: true, composed: true }));
      return;
    }
    store.setUI({ openDoc: this.doc.id, readerEdit: false });
  }

  render() {
    const d = this.doc;
    const snip = (d.body || d.url || '').slice(0, 170);
    return html`
      <div class="rcard kind-${d.kind}" @click=${() => this.#click()}>
        <div class="rt"><span class="dot" style="background:${d.kind === 'link' ? '#2288de' : '#868686'}"></span><span>${d.title || 'Untitled'}</span></div>
        <div class="snip">${snip}</div>
        ${this.linkCount ? html`<div class="links">${this.linkCount} link${this.linkCount === 1 ? '' : 's'} to script</div>` : ''}
      </div>
    `;
  }
}

customElements.define('pandemonium-research-card', PandemoniumResearchCard);

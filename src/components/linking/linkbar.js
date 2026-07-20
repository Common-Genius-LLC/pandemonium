'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';

// Purely reactive: visibility and message are entirely derived from
// ui.pendingRelink / ui.linking / ui.pair, so nothing needs to imperatively
// "show" this bar with a message string -- whatever set that ui state
// already carries enough information to derive the right copy here, which
// means this can never drift out of sync with what's actually happening.
export class PandemoniumLinkbar extends LitElement {
  static styles = css`
    :host{position:fixed;inset:0;z-index:75;pointer-events:none}
    .bar{
      position:fixed;left:50%;bottom:26px;transform:translateX(-50%);
      background:var(--res);color:#fff;border-radius:var(--r);padding:8px 14px;
      display:flex;align-items:center;gap:12px;font-size:12px;max-width:min(620px,92vw);
      pointer-events:auto;font-family:var(--sans);
    }
    button{color:#fff;font-weight:500;background:rgba(255,255,255,.18);height:22px;padding:0 10px;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);flex:none}
    button:hover{background:rgba(255,255,255,.3)}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #cancel() {
    this._store.store.setUI({ linking: null, pendingRelink: null });
  }

  #unlink() {
    if (!confirm('Remove this link between script and source?')) return;
    const id = this._store.ui.pair;
    this._store.store.deleteLink(id);
    this._store.store.setUI({ pair: null });
  }

  #close() {
    this._store.store.setUI({ pair: null });
  }

  render() {
    const ui = this._store.ui;
    if (!ui) return html``;
    if (ui.pendingRelink) {
      const messages = {
        board: 'Select the passage in the script to reattach this board.',
        link: 'Select the passage in the script to reattach this source link.',
      };
      return html`<div class="bar"><span>${messages[ui.pendingRelink.type]}</span><button @click=${() => this.#cancel()}>Cancel</button></div>`;
    }
    if (ui.linking) {
      const message = ui.linking.from === 'script'
        ? 'Pick the source: select a passage inside a doc, or click a card to link the whole document.'
        : 'Now select the matching passage in the script.';
      return html`<div class="bar"><span>${message}</span><button @click=${() => this.#cancel()}>Cancel</button></div>`;
    }
    if (ui.pair) {
      const project = this._store.project;
      const link = project.links.find((l) => l.id === ui.pair);
      const doc = link ? project.research.find((d) => d.id === link.researchId) : null;
      return html`
        <div class="bar">
          <span>Linked to "${(doc && doc.title) || 'source'}"</span>
          <button @click=${() => this.#unlink()}>Unlink</button>
          <button @click=${() => this.#close()}>Close</button>
        </div>
      `;
    }
    return nothing;
  }
}

customElements.define('pandemonium-linkbar', PandemoniumLinkbar);

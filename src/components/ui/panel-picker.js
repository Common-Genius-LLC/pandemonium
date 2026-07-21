'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { setLeafContent } from '../../data/layout-tree.js';

// The dropdown in each pane's header that switches what that pane shows
// (Script / Thumbnails / Research). It rewrites just this pane's leaf in the
// window-division tree (ui.layout), keyed by leafId.
const LABELS = { script: 'Script', boards: 'Thumbnails', research: 'Research' };

export class PdPanelPicker extends LitElement {
  static properties = { current: { type: String }, leafId: {} };

  static styles = css`
    button{
      font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);
      background:none;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
      display:inline-flex;align-items:center;gap:5px;padding:2px 6px;height:22px;margin-left:-6px;
    }
    button:hover{background:var(--panel);color:var(--ui)}
    .caret{font-size:9px;opacity:.7}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #open(e) {
    const store = this._store.store;
    const items = ['script', 'boards', 'research'].map((t) => ({
      label: LABELS[t] + (t === this.current ? '  ✓' : ''),
      fn: () => store.setUI({ layout: setLeafContent(store.ui.layout, this.leafId, t) }),
    }));
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  render() {
    return html`<button title="Switch what this pane shows" @click=${(e) => this.#open(e)}>${LABELS[this.current] || 'Panel'} <span class="caret">▾</span></button>`;
  }
}

customElements.define('pd-panel-picker', PdPanelPicker);

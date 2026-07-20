'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';

// The dropdown that replaces a panel's static title in Everything/Single
// views (notes.md point e). Clicking it opens the standard app menu with the
// three panel types; choosing one rewrites just this slot's entry in
// ui.slots (or ui.singleSlot). Slots are fully free, so no swap logic -- the
// same type may end up shown in more than one slot, which is allowed.
const LABELS = { script: 'Script', boards: 'Thumbnails', research: 'Research' };

export class PdPanelPicker extends LitElement {
  static properties = { current: { type: String }, slotId: {} };

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
      fn: () => {
        if (this.slotId === 'single') { store.setUI({ singleSlot: t }); return; }
        const slots = (store.ui.slots || ['boards', 'script', 'research']).slice();
        slots[this.slotId] = t;
        store.setUI({ slots });
      },
    }));
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  render() {
    return html`<button title="Switch what this panel shows" @click=${(e) => this.#open(e)}>${LABELS[this.current] || 'Panel'} <span class="caret">▾</span></button>`;
  }
}

customElements.define('pd-panel-picker', PdPanelPicker);

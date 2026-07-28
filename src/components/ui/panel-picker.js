'use strict';

import { LitElement, html } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { setLeafContent, PANEL_TYPES } from '../../data/layout-tree.js';
import { dropdownStyles, dropdownCaret } from './dropdown.js';

// The dropdown in each pane's header that switches what that pane shows. It
// rewrites just this pane's leaf in the window-division tree (project.layout),
// keyed by leafId. Looks come from the shared Figma panel-dropdown fragment in
// dropdown.js.
const LABELS = { script: 'Script', boards: 'Storyboards', research: 'Research', timeline: 'Timeline' };

export class PdPanelPicker extends LitElement {
  static properties = { current: { type: String }, leafId: {} };

  static styles = [dropdownStyles];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #open(e) {
    const store = this._store.store;
    const items = PANEL_TYPES.map((t) => ({
      label: LABELS[t],
      selected: t === this.current,
      fn: () => store.setLayout(setLeafContent(store.project.layout, this.leafId, t)),
    }));
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  render() {
    return html`<button class="pd-dropdown" title="Switch what this pane shows" @click=${(e) => this.#open(e)}
      >${LABELS[this.current] || 'Panel'}${dropdownCaret}</button>`;
  }
}

customElements.define('pd-panel-picker', PdPanelPicker);

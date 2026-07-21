'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { tabStyles } from '../styles/shared.js';

// One chip per script. Clicking a chip that isn't active switches to it;
// clicking the already-active chip opens its context menu (rename,
// duplicate, make final, delete) -- same two-purpose click as the original.
export class PandemoniumDraftChip extends LitElement {
  static properties = { script: { type: Object }, active: { type: Boolean, reflect: true } };

  // Figma "Final Draft" / "Other Drafts" (44:148, 44:157). tabStyles carries
  // the shape; --pane-bg is inherited from the panel shell so the active tab
  // takes the working area's own colour.
  static styles = [tabStyles, css`
    :host{display:inline-flex}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #click(e) {
    const store = this._store.store;
    if (!this.active) {
      store.setUI({ draftId: this.script.id, pair: null });
      return;
    }
    const s = this.script;
    // The final draft's name is fixed and it cannot be deleted, so neither
    // option is offered on it (see FINAL_DRAFT_NAME in data/project-model.js).
    const items = [{ label: 'Duplicate', fn: () => store.duplicateScript(s.id) }];
    if (!s.final) {
      items.unshift({ label: 'Rename', fn: () => this.#rename() });
      items.push({ label: 'Make final draft', fn: () => store.makeFinal(s.id) });
      items.push({ label: 'Delete', danger: true, fn: () => this.#delete() });
    }
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  #rename() {
    const s = this.script;
    dispatch(this, 'pandemonium-open-dialog', {
      title: 'Rename draft',
      body: html`<div class="field"><label class="lbl">Name</label><input type="text" id="f_name" .value=${s.name}></div>`,
      okLabel: 'Rename',
      onOk: (root) => {
        const v = root.querySelector('#f_name').value.trim();
        if (v) this._store.store.renameScript(s.id, v);
      },
    });
  }

  #delete() {
    const s = this.script;
    if (!confirm('Delete draft "' + s.name + '"?')) return;
    this._store.store.deleteScript(s.id);
  }

  render() {
    const s = this.script;
    const ui = this._store.ui;
    if (!ui) return html``;
    this.active = ui.draftId === s.id;
    const title = this.active ? 'Draft options: rename, duplicate, make final, delete' : 'Switch to this draft';
    return html`<button class="tab ${s.final ? 'final' : ''} ${this.active ? 'on' : ''}"
      title=${title} @click=${(e) => this.#click(e)}>${s.name}</button>`;
  }
}

customElements.define('pandemonium-draft-chip', PandemoniumDraftChip);

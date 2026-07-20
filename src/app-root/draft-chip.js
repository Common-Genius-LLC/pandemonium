'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';

// One chip per script. Clicking a chip that isn't active switches to it;
// clicking the already-active chip opens its context menu (rename,
// duplicate, make final, delete) -- same two-purpose click as the original.
export class PandemoniumDraftChip extends LitElement {
  static properties = { script: { type: Object }, active: { type: Boolean, reflect: true } };

  static styles = css`
    :host{display:inline-flex}
    button{
      height:24px;padding:0 10px;font-size:11px;font-weight:500;background:var(--panel);color:var(--ui);
      display:inline-flex;align-items:center;gap:6px;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    :host([active]) button{background:var(--ui);color:#fff}
    .fin{width:7px;height:7px;border-radius:50%;background:var(--act);flex:none}
  `;

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
    const project = this._store.project;
    const items = [
      { label: 'Rename', fn: () => this.#rename() },
      { label: 'Duplicate', fn: () => store.duplicateScript(s.id) },
    ];
    if (!s.final) items.push({ label: 'Make final draft', fn: () => store.makeFinal(s.id) });
    if (project.scripts.length > 1) items.push({ label: 'Delete', danger: true, fn: () => this.#delete() });
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
    const extra = s.final ? ' It is the final draft; another draft will become final.' : '';
    if (!confirm('Delete draft "' + s.name + '"?' + extra)) return;
    this._store.store.deleteScript(s.id);
  }

  render() {
    const s = this.script;
    const ui = this._store.ui;
    if (!ui) return html``;
    this.active = ui.draftId === s.id;
    return html`<button title=${s.final ? 'Final draft' : 'Draft'} @click=${(e) => this.#click(e)}>
      ${s.final ? html`<span class="fin"></span>` : ''}${s.name}
    </button>`;
  }
}

customElements.define('pandemonium-draft-chip', PandemoniumDraftChip);

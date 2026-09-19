'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { tabStyles } from '../styles/shared.js';

// One chip per script. Clicking a chip that isn't active switches to it;
// clicking the already-active chip opens its context menu (rename,
// duplicate, make final, delete) -- same two-purpose click as the original.
// Every non-final chip is also a drag source and drop target, so the tab
// order (Draft 2..N between the fixed First/Final ends) is freely
// rearrangeable (see reorderScript in data/project-model.js).
const DND_TYPE = 'application/x-pandemonium-draft';

export class PandemoniumDraftChip extends LitElement {
  static properties = { script: { type: Object }, leafId: {}, active: { type: Boolean, reflect: true }, _dragOver: { state: true } };

  // A pill in the panel's pill track (tabStyles). The active draft's fill is
  // the panel's sliding thumb, so this only has to say which draft it is.
  static styles = [tabStyles, css`
    :host{display:inline-flex}
    /* Where a dragged draft will land: a bar at the pill's leading edge. */
    button.dragover{box-shadow:inset 3px 0 0 var(--res)}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #click(e) {
    const store = this._store.store;
    if (!this.active) {
      // Switch only this pane's draft (per-pane, see store.scriptForLeaf), so
      // another script pane showing a different draft is left alone.
      store.setPaneDraft(this.leafId, this.script.id);
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

  #dragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DND_TYPE, this.script.id);
  }

  #dragOver(e) {
    if (![...e.dataTransfer.types].includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!this._dragOver) this._dragOver = true;
  }

  #dragLeave() {
    if (this._dragOver) this._dragOver = false;
  }

  #drop(e) {
    if (![...e.dataTransfer.types].includes(DND_TYPE)) return;
    e.preventDefault();
    this._dragOver = false;
    const draggedId = e.dataTransfer.getData(DND_TYPE);
    if (!draggedId || draggedId === this.script.id) return;
    // Dropping on a tab moves the dragged draft to just before it -- dropping
    // on the final tab lands it at the end of the reorderable run, right
    // before Final, same place a freshly created draft would appear.
    this._store.store.reorderScript(draggedId, this.script.id);
  }

  render() {
    const s = this.script;
    const ui = this._store.ui;
    if (!ui) return html``;
    // Active reflects this pane's own draft (its override, else the global one).
    this.active = this._store.store.scriptForLeaf(this.leafId).id === s.id;
    const title = this.active ? 'Draft options: rename, duplicate, make final, delete' : 'Switch to this draft';
    this.setAttribute('data-script-id', s.id);
    return html`<button class="tab ${s.final ? 'final' : ''} ${this.active ? 'on' : ''} ${this._dragOver ? 'dragover' : ''}"
      title=${title} @click=${(e) => this.#click(e)}
      draggable=${!s.final} @dragstart=${(e) => this.#dragStart(e)}
      @dragover=${(e) => this.#dragOver(e)} @dragleave=${() => this.#dragLeave()} @drop=${(e) => this.#drop(e)}
      >${s.name}</button>`;
  }
}

customElements.define('pandemonium-draft-chip', PandemoniumDraftChip);

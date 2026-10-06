'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { selectableStyles } from '../../styles/shared.js';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { withGlobalItems } from '../../utils/context-menu.js';
import { allLabels, addLabel, MAX_LABEL, NOTE_COLORS, colorToken, colorDot } from '../../data/research-doc.js';
import { icon } from './icons.js';
import { startDrag, isRefDrag, applyDrop, openMoveMenu, hasMoveTargets } from './move-menu.js';
import { askConfirm } from '../ui/confirm.js';
import { centerOf } from '../ui/confirm-place.js';

// A folder in the grid: the same size and shape as a reference card, so a
// folder reads as one more thing in the panel and not as a different kind of
// control. Click to go in. It is also where things are dropped to file them:
// drag a reference or another folder onto it.
//
// The name edits in place (a new folder opens ready to be named, and Rename
// does the same), and a folder carries labels, a colour and a note exactly as
// a reference does: the same six fills from the same swatch row, and the same
// kind of note, because "the Baddeley interviews" is as worth a line of
// explanation as any single source inside it.
export class PandemoniumFolderCard extends LitElement {
  static properties = {
    folder: { type: Object },
    count: { type: Number },
    autoEdit: { type: Boolean },
    _editing: { state: true },
    _over: { state: true },
  };

  static styles = [selectableStyles, css`
    :host{display:block}
    .fcard{
      position:relative;display:flex;flex-direction:column;gap:6px;min-height:112px;padding:12px 12px 10px;box-sizing:border-box;
      background:var(--card,var(--note-plain));border-radius:12.36px;cursor:pointer;
      transition:outline-color var(--dur-1) var(--ease-out);
      outline:2px solid transparent;outline-offset:-2px;
    }
    /* Hover is a wash, not a second fill per colour: --row-hover already flips
       with the theme, so one rule covers all six (the reference card's rule). */
    .fcard::after{content:"";position:absolute;inset:0;border-radius:inherit;background:transparent;pointer-events:none;transition:background var(--dur-1)}
    .fcard:hover::after{background:var(--row-hover)}
    /* Where a dragged item will land. */
    .fcard.over{outline-color:var(--res)}
    .fcard.over::after{background:color-mix(in srgb, var(--res) 18%, transparent)}
    .glyph{line-height:0}
    /* The glyph takes the deep reading of the folder's own colour (the swatch
       value, --note-*-dot: the same hue as the fill, saturated enough to hold
       at a glyph's size, and defined for both themes). A folder with no colour
       keeps the plain ink, because the uncoloured default is black here and the
       plain swatch grey would read as a disabled folder. */
    .glyph svg{width:30px;height:30px;fill:var(--glyph,var(--ui))}
    .nm{font-size:12px;font-weight:500;color:var(--ink);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
    input.nm{
      width:100%;box-sizing:border-box;font-family:var(--sans);border:0;outline:0;border-radius:6px;padding:1px 4px;margin:-1px -4px;
      background:var(--bg);color:var(--ink);display:block;-webkit-line-clamp:unset;
    }
    .sub{font-size:10px;color:var(--mut)}
    /* The folder's own note, where a reference card carries its preview line. */
    .note{font-size:11px;line-height:1.45;color:var(--mut);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
    .tags{display:flex;flex-wrap:wrap;gap:4px}
    .tags button{
      height:17px;padding:0 7px;font-family:var(--sans);font-size:10px;color:var(--ui);
      background:var(--bg);border:0;border-radius:20px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    .tags button:hover{background:var(--overlay);color:var(--overlay-ink)}
    .more{
      position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:var(--overlay);color:var(--overlay-ink);font-family:var(--sans);font-size:13px;line-height:1;
      opacity:0;transition:opacity var(--dur-1);pointer-events:none;
    }
    .fcard:hover .more,.more:focus-visible{opacity:1;pointer-events:auto}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._editing = false;
    this._over = false;
  }

  firstUpdated() {
    // A folder that was just made opens ready to be named.
    if (this.autoEdit) this.#edit();
  }

  #edit() {
    this._editing = true;
    this.updateComplete.then(() => {
      const el = this.renderRoot.querySelector('input.nm');
      if (el) { el.focus(); el.select(); }
    });
  }

  #commit(e) {
    if (!this._editing) return;
    this._editing = false;
    const name = e.target.value.trim();
    if (name && name !== this.folder.name) this._store.store.updateFolder(this.folder.id, { name });
  }

  #open() {
    dispatch(this, 'pandemonium-open-folder', { id: this.folder.id });
  }

  // A note about the folder, asked for the same way a label is: this card is in
  // a grid and has no room to write in, and the folder's own header (inside it)
  // is where a long note is edited in place.
  #noteDialog() {
    const store = this._store.store;
    const f = this.folder;
    dispatch(this, 'pandemonium-open-dialog', {
      title: (f.note || '').trim() ? 'Note on this folder' : 'Add a note',
      okLabel: 'Save',
      body: html`<div class="field"><label class="lbl">Note</label>
        <textarea id="f_note" placeholder="What is in here, and why">${f.note || ''}</textarea></div>`,
      onOk: (root) => {
        const note = root.querySelector('#f_note').value;
        if (note !== (f.note || '')) store.updateFolder(f.id, { note });
      },
    });
  }

  #labelDialog() {
    const store = this._store.store;
    const f = this.folder;
    const known = allLabels([...(store.project.folders || []), ...store.project.research]).map((l) => l.label);
    dispatch(this, 'pandemonium-open-dialog', {
      title: 'Label this folder',
      okLabel: 'Add',
      body: html`<div class="field"><label class="lbl">Topic</label>
        <input type="text" id="f_label" list="dl" maxlength=${MAX_LABEL} placeholder="Costume, the 1974 fire...">
        <datalist id="dl">${known.map((l) => html`<option value=${l}></option>`)}</datalist></div>`,
      onOk: (root) => {
        const next = addLabel(f.labels, root.querySelector('#f_label').value);
        if (next !== (f.labels || [])) store.updateFolder(f.id, { labels: next });
      },
    });
  }

  // Reached from a menu that has closed, so the question points at the middle
  // of the card it is about (ui/confirm.js). What happens to the contents is
  // said afterwards, in the toast: the bubble holds one line, and deleting a
  // folder never deletes what is in it.
  async #delete() {
    const f = this.folder;
    const n = this.count || 0;
    const card = this.renderRoot.querySelector('.fcard');
    if (!await askConfirm(this, { anchor: centerOf(card), question: 'Delete this folder?' })) return;
    this._store.store.deleteFolder(f.id);
    dispatch(this, 'pandemonium-toast', {
      message: n
        ? 'Folder deleted. Its ' + n + ' item' + (n === 1 ? '' : 's') + ' moved up a level.'
        : 'Folder deleted.',
    });
  }

  #menuItems(at) {
    const store = this._store.store;
    const item = { kind: 'folder', id: this.folder.id };
    const f = this.folder;
    return [
      {
        swatches: NOTE_COLORS.map((c) => ({
          label: c.label,
          color: c.dot,
          selected: (f.color || null) === c.key,
          fn: () => store.updateFolder(f.id, { color: c.key }),
        })),
      },
      { label: 'Rename', fn: () => this.#edit() },
      { label: (f.note || '').trim() ? 'Edit the note...' : 'Add a note...', fn: () => this.#noteDialog() },
      { label: 'Add a label...', fn: () => this.#labelDialog() },
      ...(hasMoveTargets(store, item) ? [{ label: 'Move to folder...', fn: () => openMoveMenu(this, store, item, at) }] : []),
      { divider: true },
      { label: 'Delete folder', danger: true, fn: () => this.#delete() },
    ];
  }

  #menu(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items: this.#menuItems({ x: r.left, y: r.bottom + 4 }) });
  }

  #contextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    const at = { x: e.clientX, y: e.clientY };
    dispatch(this, 'pandemonium-open-menu', { ...at, items: withGlobalItems(this, this.#menuItems(at)) });
  }

  #pickLabel(e, label) {
    e.stopPropagation();
    dispatch(this, 'pandemonium-pick-label', { label });
  }

  // ---- drag and drop ----
  #dragStart(e) { startDrag(e, 'folder', this.folder.id); }
  #dragOver(e) {
    if (!isRefDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!this._over) this._over = true;
  }
  #drop(e) {
    if (!isRefDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    this._over = false;
    applyDrop(this, this._store.store, e.dataTransfer, this.folder.id);
  }

  render() {
    const f = this.folder;
    const n = this.count || 0;
    return html`
      <div class="fcard ${this._over ? 'over' : ''}" draggable="true"
        style=${'--card:' + colorToken(f.color) + (f.color ? ';--glyph:' + colorDot(f.color) : '')}
        @click=${() => { if (!this._editing) this.#open(); }} @contextmenu=${(e) => this.#contextMenu(e)}
        @dragstart=${(e) => this.#dragStart(e)} @dragover=${(e) => this.#dragOver(e)}
        @dragleave=${() => { this._over = false; }} @drop=${(e) => this.#drop(e)}>
        <button class="more" title="Folder options" @click=${(e) => this.#menu(e)}>&#8943;</button>
        <span class="glyph">${icon('folderFilled')}</span>
        ${this._editing
          ? html`<input class="nm" type="text" .value=${f.name || ''} maxlength="60"
              @click=${(e) => e.stopPropagation()}
              @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = f.name || ''; e.target.blur(); } }}
              @blur=${(e) => this.#commit(e)}>`
          : html`<span class="nm">${f.name || 'Untitled'}</span>`}
        <span class="sub">${n ? n + ' item' + (n === 1 ? '' : 's') : 'Empty'}</span>
        ${(f.note || '').trim() ? html`<span class="note">${f.note}</span>` : nothing}
        ${(f.labels || []).length ? html`<div class="tags">
          ${f.labels.map((l) => html`<button title=${'Show only ' + l} @click=${(e) => this.#pickLabel(e, l)}>${l}</button>`)}
        </div>` : nothing}
      </div>
    `;
  }
}

customElements.define('pandemonium-folder-card', PandemoniumFolderCard);

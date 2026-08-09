'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import { openSourceDialog } from './source-dialog.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { dispatch } from '../../utils/events.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './research-card.js';
import './research-reader.js';

export class PandemoniumResearchPanel extends LitElement {
  static properties = { leafId: {} };

  static styles = [panelStyles, css`
    .adds{display:flex;gap:4px;flex-wrap:wrap}
    #researchList{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;align-content:start;padding:10px 10px 24px}
    .pbody.over{outline:2px solid var(--res);outline-offset:-2px}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #title() {
    return html`<pd-panel-picker current="research" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  // Dropping a file here makes a new research media from it (an opaque
  // attachment: viewable, not span-linkable). Images, video, PDFs, anything.
  #onDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('over');
  }
  #onDragLeave(e) { e.currentTarget.classList.remove('over'); }
  async #onDrop(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.currentTarget.classList.remove('over');
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    for (const file of files) {
      const data = await readFileAsDataURL(file);
      this._store.store.addResearch({ kind: 'file', title: file.name, attachment: { name: file.name, mime: file.type, data } });
    }
    dispatch(this, 'pandemonium-toast', { message: files.length === 1 ? 'Research media added.' : files.length + ' research media added.' });
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    const openDoc = project.research.find((d) => d.id === ui.openDoc);

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          ${this.#title()}
          <div class="tools">
            <div class="adds">
              <pd-button @click=${() => openSourceDialog(this, this._store.store, null, 'note')}>+ Note</pd-button>
              <pd-button @click=${() => openSourceDialog(this, this._store.store, null, 'link')}>+ Link</pd-button>
            </div>
          </div>
        </div>
        <div class="pbody"
          @dragover=${(e) => this.#onDragOver(e)}
          @dragleave=${(e) => this.#onDragLeave(e)}
          @drop=${(e) => this.#onDrop(e)}>
          ${openDoc
            ? html`<pandemonium-research-reader .doc=${openDoc}></pandemonium-research-reader>`
            : this.#renderGrid(project)}
        </div>
      </div>
    `;
  }

  #renderGrid(project) {
    if (!project.research.length) {
      return html`<div class="empty">No sources yet. Create a note or a link here, or select a passage in the script and choose <b>Source</b>.</div>`;
    }
    const counts = {};
    for (const l of project.links) counts[l.researchId] = (counts[l.researchId] || 0) + 1;
    return html`
      <div id="researchList">
        ${project.research.map((d) => html`<pandemonium-research-card .doc=${d} .linkCount=${counts[d.id] || 0}></pandemonium-research-card>`)}
      </div>
    `;
  }
}

customElements.define('pandemonium-research-panel', PandemoniumResearchPanel);

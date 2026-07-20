'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import { openSourceDialog } from './source-dialog.js';
import '../ui/button.js';
import './research-card.js';
import './research-reader.js';

export class PandemoniumResearchPanel extends LitElement {
  static styles = [panelStyles, css`
    .adds{display:flex;gap:4px}
    #researchList{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;align-content:start;padding:2px 2px 24px}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #setSplit(which) {
    this._store.store.setUI({ view: 'split', split: which, pair: null });
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    const openDoc = project.research.find((d) => d.id === ui.openDoc);

    return html`
      <div class="phead">
        <span class="lbl">Research</span>
        <div class="tools">
          <div class="adds">
            <pd-button @click=${() => openSourceDialog(this, this._store.store, null, 'note')}>+ Note</pd-button>
            <pd-button @click=${() => openSourceDialog(this, this._store.store, null, 'link')}>+ Link</pd-button>
          </div>
          <div class="mode">
            <button class=${ui.split === 'boards' ? 'on' : ''} @click=${() => this.#setSplit('boards')}>Boards</button>
            <button class=${ui.split === 'research' ? 'on' : ''} @click=${() => this.#setSplit('research')}>Research</button>
          </div>
        </div>
      </div>
      <div class="pbody">
        ${openDoc
          ? html`<pandemonium-research-reader .doc=${openDoc}></pandemonium-research-reader>`
          : this.#renderGrid(project)}
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

'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import { CHIPCOLORS } from '../utils/format.js';
import { emptyProject } from '../data/schema.js';
import { openProjectFile } from '../data/db.js';
import { sampleProject } from '../data/sample-project.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';

// Phase 1: the original's plain vertical form, unchanged in layout. Phase 2
// replaces this with the Figma-matched illustrated card (gradient
// background, clapperboard art, inline-editable project-detail card) without
// touching how a project actually gets created underneath.
export class PandemoniumStartScreen extends LitElement {
  static styles = [formStyles, chipStyles, css`
    :host{position:fixed;inset:0;background:var(--bg);z-index:60;display:flex;flex-direction:column;align-items:center;overflow:auto}
    .wrap{width:300px;margin:auto;padding:48px 0;display:flex;flex-direction:column;gap:22px}
    pd-logo{font-size:15px;color:var(--ink)}
    .tag{color:var(--mut);line-height:1.6;margin-top:-14px}
    .row2{display:flex;gap:10px}
    .row2>div{flex:1}
    .actions{display:flex;flex-direction:column;gap:8px}
    .actions pd-button{width:100%}
    .actions pd-button::part(button){width:100%;height:28px;justify-content:center}
    .foot{margin-top:26px;color:var(--mut);font-size:10px;letter-spacing:.06em}
  `];

  static properties = { _contribs: { state: true } };

  constructor() {
    super();
    this._store = new StoreController(this);
    this._contribs = [];
  }

  #field(id) {
    return this.renderRoot.getElementById(id);
  }

  #addContrib(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    this._contribs = [...this._contribs, { n: v, color: CHIPCOLORS[this._contribs.length % CHIPCOLORS.length] }];
    e.target.value = '';
  }

  #removeContrib(ix) {
    this._contribs = this._contribs.filter((_, i) => i !== ix);
  }

  #create() {
    const project = emptyProject({
      name: this.#field('npName').value.trim() || 'Untitled Project',
      workspace: this.#field('npWs').value.trim(),
      type: this.#field('npType').value.trim(),
      targetMins: parseInt(this.#field('npDur').value, 10) || 0,
      contributors: this._contribs.slice(),
    });
    this._store.store.loadProject(project);
  }

  async #openFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const project = await openProjectFile(file);
      this._store.store.loadProject(project);
    } catch (err) {
      alert('That file is not a Pandemonium project.');
    }
  }

  #loadSample() {
    this._store.store.loadProject(sampleProject());
  }

  render() {
    return html`
      <div class="wrap">
        <pd-logo></pd-logo>
        <div class="tag">A tool for creators &amp; filmmakers to manage and streamline their pre-production.</div>
        <div class="field"><label class="lbl" for="npName">Project name</label><input id="npName" type="text" placeholder="Cognitive Biases"></div>
        <div class="row2">
          <div class="field"><label class="lbl" for="npType">Type</label><input id="npType" type="text" placeholder="Animated Short"></div>
          <div class="field"><label class="lbl" for="npWs">Workspace</label><input id="npWs" type="text" placeholder="Curidosity"></div>
        </div>
        <div class="field"><label class="lbl" for="npDur">Target duration, minutes</label><input id="npDur" type="number" min="0" step="1" placeholder="22"></div>
        <div class="field">
          <label class="lbl" for="npContrib">Contributors</label>
          <input id="npContrib" type="text" placeholder="Type a name, press Enter" @keydown=${(e) => this.#addContrib(e)}>
          <div class="chips">
            ${this._contribs.map((c, ix) => html`
              <span class="chip" style="background:${c.color}"><b>${c.n}</b><span class="x" @click=${() => this.#removeContrib(ix)}>×</span></span>
            `)}
          </div>
        </div>
        <div class="actions">
          <pd-button variant="act" @click=${() => this.#create()}>Create project</pd-button>
          <pd-button @click=${() => this.renderRoot.getElementById('fileOpen').click()}>Open a project file</pd-button>
          <pd-button variant="ghost" @click=${() => this.#loadSample()}>Try the sample project</pd-button>
        </div>
        <div class="foot">A Project by Common Genius</div>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
    `;
  }
}

customElements.define('pandemonium-start-screen', PandemoniumStartScreen);

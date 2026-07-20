'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { saveProject, openProjectFile } from '../data/db.js';
import { readFileAsText, downloadBlob } from '../utils/files.js';
import { slug } from '../utils/format.js';
import { printScript, printBoards } from '../components/print/print.js';
import { getParsed } from '../fountain/cache.js';
import '../components/ui/button.js';
import './draft-chip.js';

export class PandemoniumActionsBar extends LitElement {
  static styles = css`
    :host{flex:none;display:flex;align-items:center;gap:8px;padding:8px 22px 4px}
    #draftChips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:8px;min-width:0}
    .right{margin-left:auto;display:flex;align-items:center;gap:6px}
    #saveDot{width:7px;height:7px;border-radius:50%;background:var(--act);display:none;flex:none}
    #saveDot.on{display:inline-block}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #addScript() {
    const store = this._store.store;
    const script = store.createScript({});
    store.setUI({ draftId: script.id, edit: true });
    this.updateComplete.then(() => {
      dispatch(this, 'pandemonium-toast', { message: 'New draft created. Start writing in Fountain.' });
    });
  }

  #save() {
    saveProject(this._store.project);
    this._store.store.markSaved();
    dispatch(this, 'pandemonium-toast', { message: 'Project saved to a file.' });
  }

  async #openFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const project = await openProjectFile(file);
      this._store.store.loadProject(project);
      dispatch(this, 'pandemonium-toast', { message: 'Opened "' + (project.name || 'project') + '".' });
    } catch (err) {
      dispatch(this, 'pandemonium-toast', { message: 'That file is not a Pandemonium project.' });
    }
  }

  async #importFountain(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await readFileAsText(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    const script = this._store.store.importFountain(name, text);
    this._store.store.setUI({ draftId: script.id, edit: false });
    dispatch(this, 'pandemonium-toast', { message: 'Imported "' + script.name + '" as a new draft.' });
  }

  #openExportMenu(e) {
    const store = this._store.store;
    const project = this._store.project;
    dispatch(this, 'pandemonium-open-menu', {
      anchor: e.currentTarget,
      items: [
        {
          label: 'Script PDF (print)',
          fn: () => {
            const script = store.activeScript();
            printScript(script, getParsed(script));
          },
        },
        {
          label: 'Storyboard PDF (print)',
          fn: () => {
            const ok = printBoards(store.getFinalState(), project.name);
            if (!ok) dispatch(this, 'pandemonium-toast', { message: 'No boards to export yet.' });
          },
        },
        {
          label: 'Download .fountain',
          fn: () => {
            const s = store.activeScript();
            downloadBlob(slug(s.name) + '.fountain', 'text/plain', s.text);
          },
        },
        { label: 'Import .fountain as new draft', fn: () => this.renderRoot.querySelector('#fileFountain').click() },
        { label: 'Project file (.json)', fn: () => this.#save() },
        { label: 'New project', danger: true, fn: () => this.#newProject() },
      ],
    });
  }

  #newProject() {
    if (this._store.ui.dirty && !confirm('Start a new project? Unsaved changes will be lost.')) return;
    this._store.store.closeProject();
  }

  #startSlideshow() {
    dispatch(this, 'pandemonium-open-slideshow', {});
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    return html`
      <pd-button variant="act" @click=${() => this.#startSlideshow()}>Start Slideshow</pd-button>
      <pd-button @click=${() => this.#addScript()}>Add new script</pd-button>
      <div id="draftChips">
        ${project.scripts.map((s) => html`<pandemonium-draft-chip .script=${s}></pandemonium-draft-chip>`)}
      </div>
      <div class="right">
        <span id="saveDot" class=${ui.dirty ? 'on' : ''} title="Unsaved changes"></span>
        <pd-button @click=${() => this.#save()}>Save</pd-button>
        <pd-button @click=${() => this.renderRoot.querySelector('#fileOpen').click()}>Open</pd-button>
        <pd-button @click=${(e) => this.#openExportMenu(e)}>Export</pd-button>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
      <input type="file" id="fileFountain" accept=".fountain,.txt,text/plain" style="display:none" @change=${(e) => this.#importFountain(e)}>
    `;
  }
}

customElements.define('pandemonium-actions-bar', PandemoniumActionsBar);

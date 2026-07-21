'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { saveProject, openProjectFile } from '../data/db.js';
import { readFileAsText, downloadBlob } from '../utils/files.js';
import { slug } from '../utils/format.js';
import { printScript, printBoards } from '../components/print/print.js';
import { getParsed } from '../fountain/cache.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';

// Phase 1: search is still the click-to-open command-palette button from the
// original. Phase 2 replaces it with a real inline field per the Figma
// re-skin decision (see project notes) without touching any other part of
// the topbar.
//
// Save/Open/Export/New live here (rather than a separate row below) so the
// whole app chrome fits in one header line, leaving more vertical room for
// the timesheet and the three panels.
export class PandemoniumTopbar extends LitElement {
  static properties = {};

  static styles = [formStyles, chipStyles, css`
    :host{height:48px;flex:none;display:flex;align-items:center;gap:16px;padding:0 22px}
    #brand{display:flex;align-items:baseline;gap:10px;min-width:0}
    pd-logo{font-size:15px;color:var(--ink)}
    #projName{
      font-size:12px;color:var(--mut);background:none;border:0;padding:2px 4px;
      max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    #projName:hover{background:var(--panel)}
    #searchBox{flex:1;display:flex;justify-content:center}
    #searchBtn{
      width:min(320px,100%);height:28px;background:var(--panel);color:var(--mut);
      display:flex;align-items:center;gap:8px;padding:0 10px;font-size:12px;
      border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    #searchBtn .k{margin-left:auto;font-size:10px;color:var(--mut)}
    #actions{display:flex;align-items:center;gap:6px}
    #saveDot{width:7px;height:7px;border-radius:50%;background:var(--act);display:none;flex:none;margin-right:2px}
    #saveDot.on{display:inline-block}
    @media (max-width:900px){:host{gap:8px;padding:0 14px}#projName{display:none}}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #openSettings() {
    dispatch(this, 'pandemonium-open-project-settings', {});
  }

  #openSearch() {
    this._store.store.setUI({ searchOpen: true });
  }

  #newProject() {
    if (!confirm('Start a new project? Your work here autosaves locally, but this browser will forget it once you start a new project unless you export a copy first (Export > Project file).')) return;
    // pandemonium-app owns the autosave timer and must cancel any pending
    // write before clearing the slot, or a write already in flight for the
    // project being replaced can land after the clear and resurrect it.
    dispatch(this, 'pandemonium-new-project', {});
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
    this._store.store.setUI({ draftId: script.id });
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
      ],
    });
  }

  render() {
    const project = this._store.project;
    const ui = this._store.ui;
    if (!project) return html``;
    const isMac = /mac/i.test(navigator.platform || '');
    return html`
      <div id="brand">
        <pd-logo></pd-logo>
        <button id="projName" title="Project settings" @click=${() => this.#openSettings()}>${project.name || 'Untitled'}</button>
      </div>
      <div id="searchBox">
        <button id="searchBtn" @click=${() => this.#openSearch()}>
          <span>Search</span><span style="opacity:.55">Everything</span>
          <span class="k">${isMac ? '⌘K' : 'Ctrl K'}</span>
        </button>
      </div>
      <div id="actions">
        <span id="saveDot" class=${ui.dirty ? 'on' : ''} title="Autosaved locally. Not yet exported as a file."></span>
        <pd-button @click=${() => this.#newProject()}>New</pd-button>
        <pd-button @click=${() => this.#save()} title="Download a portable .pandemonium.json backup">Save</pd-button>
        <pd-button @click=${() => this.renderRoot.querySelector('#fileOpen').click()}>Open</pd-button>
        <pd-button @click=${(e) => this.#openExportMenu(e)}>Export</pd-button>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
      <input type="file" id="fileFountain" accept=".fountain,.txt,text/plain" style="display:none" @change=${(e) => this.#importFountain(e)}>
    `;
  }
}

customElements.define('pandemonium-topbar', PandemoniumTopbar);

'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { saveProject, openProjectFile } from '../data/db.js';
import { session } from '../data/session.js';
import { readFileAsText, downloadBlob } from '../utils/files.js';
import { slug } from '../utils/format.js';
import { printScript, printBoards } from '../components/print/print.js';
import { getParsed } from '../fountain/cache.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';
import '../components/search/search-field.js';

// Figma "Title bar" (node 39:72): the grey gradient chrome, the white wordmark
// at x21, and the search field as a real 418x28 white box rather than the grey
// command-palette pill it used to be. The frame carries no buttons, so
// New/Save/Open/Export and the unsaved dot keep their place on the right.
//
// Save/Open/Export/New live here (rather than a separate row below) so the
// whole app chrome fits in one header line, leaving more vertical room for
// the timesheet and the three panels.
export class PandemoniumTopbar extends LitElement {
  static properties = {};

  static styles = [formStyles, chipStyles, css`
    /* Grid rather than flex so the search field centers on the page, where the
       frame puts it, instead of centering in whatever space the brand and the
       actions happen to leave. */
    :host{
      /* minmax(0,418px) rather than auto: the search field gives way on a
         narrow window instead of pushing the wordmark under itself. */
      height:48px;flex:none;display:grid;grid-template-columns:1fr minmax(0,418px) 1fr;
      align-items:center;gap:16px;padding:0 21px;
      background:linear-gradient(180deg,var(--chrome-a) 0%,var(--chrome-b) 100%);
    }
    #brand{justify-self:start;display:flex;align-items:center;gap:12px;min-width:0}
    pd-logo{font-size:19.824px;color:#fff}
    #projName{
      font-size:14px;color:rgba(255,255,255,.88);background:none;border:0;padding:3px 6px;
      max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      border-radius:var(--r);cursor:pointer;font-family:var(--sans);font-weight:500;
    }
    #projName:hover{background:rgba(255,255,255,.28)}
    /* The frame's 418px is a maximum, not a fixed width: the field gives way
       on a narrow window rather than pushing the wordmark under itself. */
    #searchBox{justify-self:stretch;min-width:0;display:flex;justify-content:center}
    pandemonium-search-field{width:100%;max-width:418px}
    #actions{justify-self:end;display:flex;align-items:center;gap:6px}
    #saveDot{width:7px;height:7px;border-radius:50%;background:var(--act);display:none;flex:none;margin-right:2px}
    #saveDot.on{display:inline-block}
    @media (max-width:1100px){
      :host{
        height:auto;
        grid-template-columns:auto minmax(0,1fr);
        grid-template-areas:
          "brand actions"
          "search search";
        row-gap:8px;
        padding:8px 14px;
      }
      #brand{grid-area:brand}
      #searchBox{grid-area:search}
      #actions{grid-area:actions;flex-wrap:wrap;justify-content:flex-end}
      pandemonium-search-field{max-width:none}
    }
    @media (max-width:760px){
      :host{
        grid-template-columns:minmax(0,1fr);
        grid-template-areas:
          "brand"
          "actions"
          "search";
        gap:8px;
      }
      #projName{display:none}
      #actions{
        justify-content:flex-start;
        flex-wrap:nowrap;
        overflow:auto hidden;
        padding-bottom:2px;
      }
      #actions::-webkit-scrollbar{height:6px}
      #actions::-webkit-scrollbar-thumb{background:var(--ph);border-radius:4px}
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._onSession = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    session.addEventListener('change', this._onSession);
  }

  disconnectedCallback() {
    session.removeEventListener('change', this._onSession);
    super.disconnectedCallback();
  }

  #openAccount() {
    dispatch(this, 'pandemonium-open-account', {});
  }

  #accountLabel() {
    const user = session.getUser();
    if (!user) return 'Account';
    const name = user.displayName || user.email || '';
    return name.length > 16 ? name.slice(0, 15) + '…' : name;
  }

  #openSettings() {
    dispatch(this, 'pandemonium-open-project-settings', {});
  }

  #newProject() {
    const msg = session.isAuthed()
      ? 'Start a new project? The one open now stays saved in your account (find it under Account), and you can also export a copy first (Export > Project file).'
      : 'Start a new project? Your work here autosaves locally, but this browser will forget it once you start a new project unless you export a copy first (Export > Project file).';
    if (!confirm(msg)) return;
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
        <pandemonium-search-field title=${'Search everything (' + (isMac ? '⌘K' : 'Ctrl K') + ')'}></pandemonium-search-field>
      </div>
      <div id="actions">
        <span id="saveDot" class=${ui.dirty ? 'on' : ''} title=${session.isAuthed() ? 'Syncing to your account. Not yet exported as a file.' : 'Autosaved in this browser. Not yet exported as a file.'}></span>
        <pd-button @click=${() => this.#newProject()}>New</pd-button>
        <pd-button @click=${() => this.#save()} title="Download a portable .pandemonium.json backup">Save</pd-button>
        <pd-button @click=${() => this.renderRoot.querySelector('#fileOpen').click()}>Open</pd-button>
        <pd-button @click=${(e) => this.#openExportMenu(e)}>Export</pd-button>
        <pd-button variant=${session.isAuthed() ? 'default' : 'pink'} @click=${() => this.#openAccount()}
          title=${session.isAuthed() ? 'Your account and cloud projects' : 'Sign in to sync your projects'}>
          ${session.isAuthed() ? this.#accountLabel() : 'Sign in'}
        </pd-button>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
      <input type="file" id="fileFountain" accept=".fountain,.txt,text/plain" style="display:none" @change=${(e) => this.#importFountain(e)}>
    `;
  }
}

customElements.define('pandemonium-topbar', PandemoniumTopbar);

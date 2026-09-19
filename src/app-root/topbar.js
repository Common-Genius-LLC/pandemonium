'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { saveProject, openProjectFile } from '../data/db.js';
import { session } from '../data/session.js';
import { syncStatus } from '../state/sync-status.js';
import { readFileAsText, downloadBlob } from '../utils/files.js';
import { slug } from '../utils/format.js';
import { printScript, printBoards } from '../components/print/print.js';
import { getParsed } from '../fountain/cache.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';
import '../components/ui/settings-dialog.js';
import '../components/search/search-field.js';

// Figma "Title bar" (node 39:72): the grey gradient chrome, the white wordmark
// at x21, and the search field as a real 418x28 white box rather than the grey
// command-palette pill it used to be. The frame carries no buttons, so
// New/Save/Open/Export and the unsaved dot keep their place on the right.
//
// Save/Open/Export/New live here (rather than a separate row below) so the
// whole app chrome fits in one header line, leaving more vertical room for
// the panels below it.
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
    /* The one way back to the home screen used to be buried in the File
       menu's "New project" item, which nobody reads a whole menu to find.
       The wordmark is the standard place a web app puts that. */
    #homeBtn{display:flex;align-items:center;background:none;border:0;padding:4px;border-radius:var(--r);cursor:pointer;flex:none}
    #homeBtn:hover{background:rgba(255,255,255,.16)}
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
    /* Sync status, not a generic "unsaved" marker: amber while anything is
       still on its way to storage, green once it has landed, red when the last
       write was refused. Always visible, because a dot that only appears when
       something is wrong cannot tell you that things are right. */
    #saveDot{width:7px;height:7px;border-radius:50%;flex:none;margin-right:2px;transition:background .18s}
    #saveDot.pending{background:var(--act)}
    #saveDot.synced{background:var(--ok)}
    #saveDot.failed{background:var(--danger)}
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
    this._onSync = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    session.addEventListener('change', this._onSession);
    syncStatus.addEventListener('change', this._onSync);
  }

  disconnectedCallback() {
    session.removeEventListener('change', this._onSession);
    syncStatus.removeEventListener('change', this._onSync);
    super.disconnectedCallback();
  }

  // What the dot says, in the two modes the app can be in. Signed out, "synced"
  // means written to this browser; signed in, it means written to the account.
  // The distinction matters enough to say out loud on hover.
  #syncTitle() {
    const where = session.isAuthed() ? 'your account' : 'this browser';
    if (syncStatus.state === 'failed') {
      return 'Not saved: the last write failed. ' + (syncStatus.detail || 'Check your connection.')
        + ' Use File > Export > Project file to keep a copy.';
    }
    if (syncStatus.state === 'pending') return 'Saving to ' + where + '...';
    return 'All changes saved to ' + where + '.';
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

  // pandemonium-app owns the autosave timer: it flushes the outgoing
  // project's latest state to storage before doing anything else (see
  // #flushAutosave there), so this does not need to ask first.
  #newProject() {
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

  // Everything that acts on the project as a file lives here now, so the title
  // bar carries one control instead of five and the search field keeps the
  // width it was designed at. The anchor is passed down through both levels so
  // the export submenu opens under the same button.
  #openFileMenu(e) {
    const anchor = e.currentTarget;
    const items = [
      { label: 'New project', fn: () => this.#newProject() },
      { label: 'Open project file...', fn: () => this.renderRoot.querySelector('#fileOpen').click() },
      { label: 'Save a copy', fn: () => this.#save() },
    ];
    if (session.isAuthed()) {
      items.push({ label: 'Share...', fn: () => dispatch(this, 'pandemonium-open-share', {}) });
    }
    items.push({ label: 'Export', fn: () => this.#openExportMenu(anchor) });
    items.push({ divider: true });
    items.push({ label: 'Settings...', fn: () => this.#openAppSettings() });
    dispatch(this, 'pandemonium-open-menu', { anchor, items });
  }

  // One window for every preference. The theme used to be a glyph in the title
  // bar and a row on every right-click menu, and the storyboard drop target a
  // submenu two levels into File: three corners for two decisions. The only
  // button is Done, because every control acts as it is touched.
  #openAppSettings() {
    dispatch(this, 'pandemonium-open-dialog', {
      title: 'Settings',
      width: 440,
      doneOnly: true,
      body: html`<pd-settings></pd-settings>`,
    });
  }

  #openExportMenu(anchor) {
    const store = this._store.store;
    const project = this._store.project;
    dispatch(this, 'pandemonium-open-menu', {
      anchor,
      items: [
        {
          label: 'Script PDF (print)',
          fn: () => {
            const script = store.activeScript();
            const parsed = getParsed(script);
            if (!parsed.blocks.some((b) => b.line != null && b.plain && b.plain.trim())) {
              dispatch(this, 'pandemonium-toast', { message: 'Write some script before you export it.' });
              return;
            }
            printScript(script, parsed);
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
    if (!project) return html``;
    const isMac = /mac/i.test(navigator.platform || '');
    return html`
      <div id="brand">
        <button id="homeBtn" title="Home" @click=${() => this.#newProject()}><pd-logo></pd-logo></button>
        <button id="projName" data-clarity-mask="true" title="Project settings" @click=${() => this.#openSettings()}>${project.name || 'Untitled'}</button>
      </div>
      <div id="searchBox" data-clarity-mask="true">
        <pandemonium-search-field title=${'Search everything (' + (isMac ? '⌘K' : 'Ctrl K') + ')'}></pandemonium-search-field>
      </div>
      <div id="actions">
        <span id="saveDot" class=${syncStatus.state} title=${this.#syncTitle()}></span>
        <pd-button @click=${(e) => this.#openFileMenu(e)} title="New, open, save, share and export">File</pd-button>
        <pd-button data-clarity-mask="true" variant=${session.isAuthed() ? 'default' : 'pink'} @click=${() => this.#openAccount()}
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

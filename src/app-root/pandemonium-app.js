'use strict';

import { LitElement, html, css } from 'lit';
import { ContextProvider } from '@lit/context';
import { storeContext } from '../state/context.js';
import { PandemoniumStore } from '../state/store.js';
import { dispatch } from '../utils/events.js';
import { saveProject, autosaveProject, loadAutosavedProject, clearAutosavedProject } from '../data/db.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import { CHIPCOLORS, debounce } from '../utils/format.js';
import { imageFromClipboard } from '../utils/clipboard.js';
import { readFileAsDataURL } from '../utils/files.js';

import './start-screen.js';
import './topbar.js';
import './actions-bar.js';
import './timesheet.js';
import './panel-layout.js';
import '../components/ui/toast.js';
import '../components/ui/dialog.js';
import '../components/ui/menu.js';
import '../components/linking/selection-toolbar.js';
import '../components/linking/linkbar.js';
import '../components/linking/highlight-popover.js';
import '../components/linking/comment-popover.js';
import '../components/search/search-overlay.js';
import '../components/slideshow/slideshow.js';

// The root shell. Owns the one PandemoniumStore instance for the whole app
// and hands it down through Lit Context (see state/context.js) rather than
// passing it as a prop through every layer -- topbar/actions-bar/timesheet/
// the three panels are all several levels deep and all need read+write
// access to the same project/ui state.
//
// Also hosts the "overlay layer": toast, dialog, menu, the floating
// selection toolbar, linkbar, board popover, and the connector line. These
// are mounted here, as direct children of app-root, specifically so they
// are never nested inside another component's shadow root -- see each
// component's own file for why that matters (cross-shadow floating UI,
// print root visibility, etc).
export class PandemoniumApp extends LitElement {
  static styles = [formStyles, chipStyles, css`
    :host{display:block;height:100%}
    .app{height:100%;display:flex;flex-direction:column}
    #toastHost,#dialogHost{position:fixed;inset:0;pointer-events:none;z-index:90}
  `];

  #debouncedAutosave;

  constructor() {
    super();
    this.store = new PandemoniumStore();
    this._provider = new ContextProvider(this, { context: storeContext, initialValue: this.store });
    // Not a StoreController: this element hosts the ContextProvider itself,
    // and @lit/context deliberately won't satisfy a context-request from a
    // provider's own host (see store-controller.js). Listen directly.
    this.store.addEventListener('change', () => this.requestUpdate());
    // Autosave: every project change writes to IndexedDB (see data/db.js),
    // debounced so continuous typing doesn't trigger a multi-megabyte write
    // (embedded board images) on every keystroke. This is what replaced
    // "you must remember to click Save or lose your work" -- explicit
    // Save/Open still exist for portable file backups, this is just
    // continuity across reloads.
    this.#debouncedAutosave = debounce((project) => {
      autosaveProject(project).catch((err) => console.warn('Autosave failed:', err));
    }, 1500);
    this.store.addEventListener('change', () => {
      if (this.store.project) this.#debouncedAutosave(this.store.project);
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pandemonium-toast', (e) => this.renderRoot.getElementById('toast').show(e.detail.message));
    this.addEventListener('pandemonium-open-dialog', (e) => this.renderRoot.getElementById('dialog').open(e.detail));
    this.addEventListener('pandemonium-open-menu', (e) => this.renderRoot.getElementById('menu').open(e.detail));
    this.addEventListener('pandemonium-show-selection-toolbar', (e) => this.renderRoot.getElementById('selToolbar').open(e.detail));
    this.addEventListener('pandemonium-show-board-popover', (e) => this.renderRoot.getElementById('boardPopover').open(e.detail));
    this.addEventListener('pandemonium-show-comment', (e) => this.renderRoot.getElementById('commentPopover').open(e.detail));
    this.addEventListener('pandemonium-open-slideshow', () => this.renderRoot.getElementById('slideshow').open());
    this.addEventListener('pandemonium-open-project-settings', () => this.#openProjectSettings());
    this.addEventListener('pandemonium-new-project', () => this.#newProject());
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('paste', this.#onPaste);
    loadAutosavedProject().then((project) => {
      if (project && !this.store.project) this.store.loadProject(project);
    }).catch((err) => console.warn('Could not read autosaved project:', err));
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.#onKeydown);
    document.removeEventListener('paste', this.#onPaste);
    super.disconnectedCallback();
  }

  #newProject() {
    // Cancel first: a debounced write already scheduled for the project
    // being replaced must not land after clearAutosavedProject() runs, or
    // it silently resurrects the "closed" project on next load.
    this.#debouncedAutosave.cancel();
    this.store.closeProject();
    clearAutosavedProject().catch((err) => console.warn('Could not clear autosaved project:', err));
  }

  #onKeydown = (e) => {
    const store = this.store;
    if (!store.project) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); store.setUI({ searchOpen: true }); return; }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject(store.project);
      store.markSaved();
      dispatch(this, 'pandemonium-toast', { message: 'Project saved to a file.' });
      return;
    }
    if (e.key === 'Escape') {
      const ui = store.ui;
      if (ui.searchOpen) { store.setUI({ searchOpen: false }); return; }
      if (ui.linking || ui.pendingRelink) { store.setUI({ linking: null, pendingRelink: null }); return; }
      if (ui.pair) { store.setUI({ pair: null }); return; }
    }
  };

  // Fallback for pasting an image anywhere that isn't the script editor
  // (which handles its own paste and calls stopPropagation() when it does,
  // so this never double-adds a board). Always creates an unattached board;
  // attach it to a passage later via its card's "Reattach" button.
  #onPaste = async (e) => {
    const store = this.store;
    if (!store.project) return;
    const file = imageFromClipboard(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const img = await readFileAsDataURL(file);
    store.addBoard({ parts: [], img, caption: '' });
    dispatch(this, 'pandemonium-toast', { message: 'Board added. Select a script passage anytime to attach it.' });
  };

  #openProjectSettings() {
    const project = this.store.project;
    let contribs = project.contributors.slice();
    const renderChips = (root) => {
      const holder = root.getElementById('f_chips');
      holder.innerHTML = contribs.map((c, ix) => `<span class="chip" style="background:${c.color}"><b></b><span class="x" data-ix="${ix}">×</span></span>`).join('');
      holder.querySelectorAll('b').forEach((b, ix) => { b.textContent = contribs[ix].n; });
      holder.querySelectorAll('.x').forEach((x) => {
        x.onclick = () => { contribs = contribs.filter((_, i) => i !== parseInt(x.dataset.ix, 10)); renderChips(root); };
      });
    };
    dispatch(this, 'pandemonium-open-dialog', {
      title: 'Project',
      okLabel: 'Save',
      body: html`
        <div class="field"><label class="lbl">Name</label><input type="text" id="f_pn" .value=${project.name}></div>
        <div class="row">
          <div class="field"><label class="lbl">Type</label><input type="text" id="f_pt" .value=${project.type || ''}></div>
          <div class="field"><label class="lbl">Workspace</label><input type="text" id="f_pw" .value=${project.workspace || ''}></div>
        </div>
        <div class="field"><label class="lbl">Target duration, minutes</label><input type="number" min="0" id="f_pd" .value=${project.targetMins || ''}></div>
        <div class="field">
          <label class="lbl">Contributors</label>
          <input type="text" id="f_pc" placeholder="Type a name, press Enter"
            @keydown=${(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = e.target.value.trim();
              if (!v) return;
              contribs.push({ n: v, color: CHIPCOLORS[contribs.length % CHIPCOLORS.length] });
              e.target.value = '';
              renderChips(e.target.getRootNode());
            }}>
          <div class="chips" id="f_chips" style="margin-top:6px"></div>
        </div>
      `,
      onOk: (root) => {
        this.store.updateProjectMeta({
          name: root.querySelector('#f_pn').value,
          type: root.querySelector('#f_pt').value,
          workspace: root.querySelector('#f_pw').value,
          targetMins: root.querySelector('#f_pd').value,
        });
        this.store.setContributors(contribs);
      },
    });
    this.updateComplete.then(() => {
      const root = this.renderRoot.getElementById('dialog').renderRoot;
      renderChips(root);
    });
  }

  render() {
    const project = this.store.project;
    return html`
      ${!project ? html`<pandemonium-start-screen></pandemonium-start-screen>` : html`
        <div class="app">
          <pandemonium-topbar></pandemonium-topbar>
          <pandemonium-actions-bar></pandemonium-actions-bar>
          <pandemonium-timesheet></pandemonium-timesheet>
          <pandemonium-panel-layout view=${this.store.ui.view} split=${this.store.ui.split}></pandemonium-panel-layout>
        </div>
      `}
      <pd-toast id="toast"></pd-toast>
      <pd-dialog id="dialog"></pd-dialog>
      <pd-menu id="menu"></pd-menu>
      <pandemonium-selection-toolbar id="selToolbar"></pandemonium-selection-toolbar>
      <pandemonium-linkbar></pandemonium-linkbar>
      <pandemonium-highlight-popover id="boardPopover"></pandemonium-highlight-popover>
      <pandemonium-comment-popover id="commentPopover"></pandemonium-comment-popover>
      <pandemonium-search-overlay></pandemonium-search-overlay>
      <pandemonium-slideshow id="slideshow"></pandemonium-slideshow>
    `;
  }
}

customElements.define('pandemonium-app', PandemoniumApp);

'use strict';

import { LitElement, html, css } from 'lit';
import { ContextProvider } from '@lit/context';
import { storeContext } from '../state/context.js';
import { PandemoniumStore } from '../state/store.js';
import { dispatch } from '../utils/events.js';
import { saveProject, autosaveProject, loadAutosavedProject, clearAutosavedProject, loadRemoteProject } from '../data/db.js';
import { session } from '../data/session.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import { debounce } from '../utils/format.js';
import { imageFromClipboard } from '../utils/clipboard.js';
import { readFileAsDataURL } from '../utils/files.js';

import './start-screen.js';
import './topbar.js';
import './timesheet.js';
import './panel-layout.js';
import '../components/ui/toast.js';
import '../components/ui/dialog.js';
import '../components/ui/menu.js';
import '../components/ui/project-card.js';
import '../components/linking/selection-toolbar.js';
import '../components/linking/linkbar.js';
import '../components/linking/highlight-popover.js';
import '../components/linking/comment-popover.js';
import '../components/slideshow/slideshow.js';
import '../components/auth/account-dialog.js';

// The root shell. Owns the one PandemoniumStore instance for the whole app
// and hands it down through Lit Context (see state/context.js) rather than
// passing it as a prop through every layer -- topbar/timesheet/the three
// panels are all several levels deep and all need read+write access to the
// same project/ui state.
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
    this.addEventListener('pandemonium-open-account', () => this.renderRoot.getElementById('accountDialog').open());
    this.addEventListener('pandemonium-open-remote-project', (e) => this.#openRemoteProject(e.detail.id));
    this.addEventListener('pandemonium-push-current-to-cloud', () => this.#pushToCloud());
    // Account state (signed in/out) changes what the topbar and start screen
    // offer; re-render on it as well as on store changes.
    session.addEventListener('change', () => this.requestUpdate());
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('paste', this.#onPaste);
    this.#boot();
  }

  // Restore any signed-in session first (trades the refresh cookie for a token),
  // then load the project the current mode points at: the last cloud project if
  // signed in, otherwise the local IndexedDB autosave.
  async #boot() {
    await session.restore().catch(() => {});
    try {
      const project = await loadAutosavedProject();
      if (project && !this.store.project) this.store.loadProject(project);
    } catch (err) {
      console.warn('Could not restore a project:', err);
    }
  }

  // Opening a cloud project: cancel any pending autosave for the outgoing
  // project first, or a write already scheduled against the old id can land
  // after the switch (same hazard as #newProject).
  async #openRemoteProject(id) {
    this.#debouncedAutosave.cancel();
    try {
      const project = await loadRemoteProject(id);
      this.store.loadProject(project);
    } catch (err) {
      dispatch(this, 'pandemonium-toast', { message: 'Could not open that project.' });
    }
  }

  // Push the open project into the account right after sign-in, so nothing that
  // was being worked on locally is left behind.
  async #pushToCloud() {
    if (!this.store.project) return;
    try {
      await autosaveProject(this.store.project);
    } catch (err) {
      dispatch(this, 'pandemonium-toast', { message: 'Could not sync this project to your account.' });
    }
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
    // Cmd/Ctrl-K puts the caret in the title bar's search field. There is no
    // separate search surface to open any more.
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const bar = this.renderRoot.querySelector('pandemonium-topbar');
      const field = bar && bar.renderRoot.querySelector('pandemonium-search-field');
      if (field) field.focusField();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject(store.project);
      store.markSaved();
      dispatch(this, 'pandemonium-toast', { message: 'Project saved to a file.' });
      return;
    }
    if (e.key === 'Escape') {
      const ui = store.ui;
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

  // Clicking the project name opens the same clapperboard card the project
  // was created on, rather than a second, plainer form of the same fields.
  // It writes through on every keystroke, so dismissing it is not a decision:
  // there is nothing pending to keep or discard.
  #openProjectSettings() {
    const project = this.store.project;
    const commit = (v) => {
      this.store.updateProjectMeta({
        name: v.name || project.name,
        type: v.type,
        workspace: v.workspace,
        targetMins: v.targetMins,
      });
      this.store.setContributors(v.contributors);
    };
    dispatch(this, 'pandemonium-open-dialog', {
      bare: true,
      body: html`<pd-project-card
        elevated
        .projectName=${project.name || ''}
        .type=${project.type || ''}
        .workspace=${project.workspace || ''}
        .mins=${project.targetMins || 0}
        .contributors=${project.contributors}
        @pd-project-change=${(e) => commit(e.detail)}
      ></pd-project-card>`,
      // Belt and braces: catches a value the change event could not, such as
      // a duration still mid-edit when the card is dismissed.
      onOk: (root) => {
        const card = root.querySelector('pd-project-card');
        if (card) commit(card.read());
      },
    });
  }

  render() {
    const project = this.store.project;
    return html`
      ${!project ? html`<pandemonium-start-screen></pandemonium-start-screen>` : html`
        <div class="app">
          <pandemonium-topbar></pandemonium-topbar>
          <pandemonium-timesheet></pandemonium-timesheet>
          <pandemonium-panel-layout></pandemonium-panel-layout>
        </div>
      `}
      <pd-toast id="toast"></pd-toast>
      <pd-dialog id="dialog"></pd-dialog>
      <pd-menu id="menu"></pd-menu>
      <pandemonium-selection-toolbar id="selToolbar"></pandemonium-selection-toolbar>
      <pandemonium-linkbar></pandemonium-linkbar>
      <pandemonium-highlight-popover id="boardPopover"></pandemonium-highlight-popover>
      <pandemonium-comment-popover id="commentPopover"></pandemonium-comment-popover>
      <pandemonium-slideshow id="slideshow"></pandemonium-slideshow>
      <pd-account-dialog id="accountDialog"></pd-account-dialog>
    `;
  }
}

customElements.define('pandemonium-app', PandemoniumApp);

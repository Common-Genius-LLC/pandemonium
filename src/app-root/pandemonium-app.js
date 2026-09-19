'use strict';

import { LitElement, html, css } from 'lit';
import { ContextProvider } from '@lit/context';
import { storeContext } from '../state/context.js';
import { PandemoniumStore } from '../state/store.js';
import { dispatch } from '../utils/events.js';
import { saveProject, autosaveProject, loadAutosavedProject, clearAutosavedProject, loadRemoteProject, loadSharedProjection } from '../data/db.js';
import { setConflictHandler, saveMergedRemote } from '../data/remote-api-adapter.js';
import { session } from '../data/session.js';
import { syncStatus } from '../state/sync-status.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import { debounce } from '../utils/format.js';
import { imageFromClipboard } from '../utils/clipboard.js';
import { readFileAsDataURL } from '../utils/files.js';
import { BETA } from '../config/beta.js';
import { bugReporter } from '../utils/bug-report.js';
import { withGlobalItems } from '../utils/context-menu.js';

import './start-screen.js';
import './topbar.js';
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
import '../components/collab/merge-dialog.js';
import '../components/collab/share-dialog.js';

// The root shell. Owns the one PandemoniumStore instance for the whole app
// and hands it down through Lit Context (see state/context.js) rather than
// passing it as a prop through every layer: the topbar and every panel are
// several levels deep and all need read+write access to the same project/ui
// state.
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
      autosaveProject(project).then(
        () => syncStatus.markSynced(),
        (err) => {
          const msg = (err && err.message) || '';
          syncStatus.markFailed(msg);
          // A viewer-role collaborator's writes are refused by the server. Say
          // so once instead of letting every keystroke fail into the console:
          // the person typing believes their work is syncing, and it is not.
          if (!this._warnedViewOnly && /view access/i.test(msg)) {
            this._warnedViewOnly = true;
            dispatch(this, 'pandemonium-toast', { message: 'You have view access to this project: your edits stay in this window and do not sync. Export a copy (File > Export > Project file) to keep them.' });
          }
          console.warn('Autosave failed:', err);
        },
      );
    }, 1500);
    this.store.addEventListener('change', () => {
      // A shared read-only view (see #bootSharedView) is a visitor's copy of
      // someone else's script: autosaving it would overwrite whatever project
      // this browser's own local slot holds.
      if (!this.store.project || this._sharedView) return;
      syncStatus.markPending();
      this.#debouncedAutosave(this.store.project);
    });
    // The remote adapter hands every 409 here instead of retrying over the
    // other writer's work. A clean merge is applied and pushed straight back;
    // one with conflicts opens the merge dialog (it renders off ui.merge).
    setConflictHandler((conflict) => {
      const out = this.store.beginMerge(conflict);
      if (out && out.clean) {
        saveMergedRemote(out.project, out.theirUpdatedAt)
          .then(() => syncStatus.markSynced(), (err) => { syncStatus.markFailed(err && err.message); console.warn('Merged save failed:', err); });
        dispatch(this, 'pandemonium-toast', { message: 'Merged changes from another device or collaborator.' });
      }
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
    this.addEventListener('pandemonium-open-slideshow', (e) => this.renderRoot.getElementById('slideshow').open((e.detail) || {}));
    this.addEventListener('pandemonium-open-project-settings', () => this.#openProjectSettings());
    this.addEventListener('pandemonium-new-project', () => this.#newProject());
    this.addEventListener('pandemonium-open-account', () => this.renderRoot.getElementById('accountDialog').open());
    this.addEventListener('pandemonium-open-remote-project', (e) => this.#openRemoteProject(e.detail.id));
    this.addEventListener('pandemonium-push-current-to-cloud', () => this.#pushToCloud());
    this.addEventListener('pandemonium-open-share', () => this.renderRoot.getElementById('shareDialog').open());
    this.addEventListener('pandemonium-merge-committed', (e) => {
      saveMergedRemote(e.detail.project, e.detail.theirUpdatedAt)
        .then(() => syncStatus.markSynced(), (err) => { syncStatus.markFailed(err && err.message); console.warn('Merged save failed:', err); });
    });
    // Account state (signed in/out) changes what the topbar and start screen
    // offer; re-render on it as well as on store changes.
    session.addEventListener('change', () => this.requestUpdate());
    // Disables the browser's native menu everywhere and offers the global
    // items (see utils/context-menu.js). Panel leaves handle their own
    // right-click with more specific items first and stopPropagation() before
    // it reaches here (panel-layout.js), so this only ever fires for chrome
    // outside any panel: the topbar, the start screen, dialogs.
    this.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      dispatch(this, 'pandemonium-open-menu', { x: e.clientX, y: e.clientY, items: withGlobalItems(this) });
    });
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('paste', this.#onPaste);
    this.#installBeta();
    this.#boot();
  }

  // BETA is a build-time constant (see config/beta.js), so with beta switched
  // off Rollup drops this body and the dynamic import never becomes part of
  // the graph: no error capture, no dialog, no beta code in the bundle.
  // Reporting is reached from the context menu (utils/context-menu.js) rather
  // than a dedicated badge now, but the dialog and capture themselves are
  // unchanged.
  #installBeta() {
    if (!BETA) return;
    // Before the import: an error thrown while the beta UI is still loading
    // is exactly the kind worth catching.
    bugReporter.install();
    import('../components/beta/bug-report-dialog.js');
    this.addEventListener('pandemonium-open-bug-report', () => this.#openBugReport());
  }

  #openBugReport() {
    customElements.whenDefined('pd-bug-report-dialog').then(() => {
      const el = this.renderRoot.getElementById('bugReport');
      if (el) el.open();
    });
  }

  // Restore any signed-in session first (trades the refresh cookie for a token),
  // then load the project the current mode points at: the last cloud project if
  // signed in, otherwise the local IndexedDB autosave. A share link in the URL
  // takes over the whole boot instead.
  async #boot() {
    if (await this.#bootSharedView()) return;
    await session.restore().catch(() => {});
    try {
      const project = await loadAutosavedProject();
      if (project && !this.store.project) this.store.loadProject(project);
    } catch (err) {
      console.warn('Could not restore a project:', err);
    }
  }

  // ?share=TOKEN opens a read-only projection of someone's final draft and
  // boards, no account required. It is a visitor's copy: it never autosaves
  // (see the guard in the constructor), so it cannot clobber this browser's
  // own local project, and closing the tab is how you leave.
  async #bootSharedView() {
    const token = new URLSearchParams(location.search).get('share');
    if (!token) return false;
    this._sharedView = true;
    try {
      const projection = await loadSharedProjection(token);
      this.store.loadProject(projection);
      dispatch(this, 'pandemonium-toast', {
        message: 'Viewing a shared script. This is a read-only copy: edits here stay in this window and are not saved anywhere.',
      });
    } catch (err) {
      this._sharedView = false;
      dispatch(this, 'pandemonium-toast', { message: 'That share link is not valid any more.' });
    }
    return true;
  }

  // Leaving the open project (for the home screen, a new project, or another
  // one entirely): flushes the outgoing project's latest state to storage
  // right now, rather than merely cancelling the pending debounced write and
  // letting whatever changed in the last second or two evaporate. This is
  // what lets #newProject and #openRemoteProject act immediately with no
  // "are you sure?" gate -- the answer is always "yes, and it is saved
  // first." A signed-in save reaches the account; a signed-out one reaches
  // this browser's local slot (see clearAutosavedProject's own note on why
  // that slot, specifically, is always safe to clear next).
  async #flushAutosave() {
    this.#debouncedAutosave.cancel();
    if (!this.store.project) return;
    try {
      await autosaveProject(this.store.project);
      syncStatus.markSynced();
    } catch (err) {
      syncStatus.markFailed(err && err.message);
      console.warn('Could not save before leaving:', err);
      dispatch(this, 'pandemonium-toast', { message: 'Your last changes could not be saved. They may be lost if you continue.' });
    }
  }

  async #openRemoteProject(id) {
    await this.#flushAutosave();
    // A conflict during the flush opens the merge dialog (setConflictHandler
    // in the constructor); switching projects out from under it would wipe
    // ui.merge and strand that conflict unresolved, so let it take over.
    if (this.store.ui && this.store.ui.merge) return;
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

  async #newProject() {
    await this.#flushAutosave();
    if (this.store.ui && this.store.ui.merge) return; // see #openRemoteProject
    this.store.closeProject();
    clearAutosavedProject().catch((err) => console.warn('Could not clear autosaved project:', err));
  }

  #onKeydown = (e) => {
    const store = this.store;
    // Before the no-project guard: a tester needs to be able to report a bug
    // from the start screen too, which is where a failed restore lands them.
    if (BETA && e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      this.#openBugReport();
      return;
    }
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
    // Pasted images always start as reference frames, regardless of the
    // drop-target setting: a paste is inspiration for a beat, not a
    // deliberate "this is the final frame" choice.
    store.addBoard({ parts: [], img, caption: '', mode: 'reference' });
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
      <pd-merge-dialog></pd-merge-dialog>
      <pd-share-dialog id="shareDialog"></pd-share-dialog>
      ${BETA ? html`<pd-bug-report-dialog id="bugReport"></pd-bug-report-dialog>` : ''}
    `;
  }
}

customElements.define('pandemonium-app', PandemoniumApp);

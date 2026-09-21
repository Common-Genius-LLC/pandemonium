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
import { trackVirtualView } from '../utils/analytics.js';
import { screenFor, isLoginPath } from './gate.js';

import './start-screen.js';
import '../components/landing/landing.js';
import '../components/auth/login.js';
import './topbar.js';
import './panel-layout.js';
import '../components/ui/toast.js';
import '../components/ui/dialog.js';
import '../components/ui/menu.js';
import '../components/ui/logo.js';
import '../components/ui/project-card.js';
import '../components/linking/selection-toolbar.js';
import '../components/linking/linkbar.js';
import '../components/linking/link-popover.js';
import '../components/linking/comment-popover.js';
import '../components/slideshow/slideshow.js';
import '../components/auth/account-dialog.js';
import '../components/collab/merge-dialog.js';
import '../components/collab/share-dialog.js';

// The screens that live outside a project, as analytics views (structure only,
// nothing of anyone's work). The start screen's path matches the store's own.
const SCREEN_VIEWS = {
  landing: { title: 'Landing', path: '/' },
  login: { title: 'Sign in', path: '/login' },
  start: { title: 'Start screen', path: '/start' },
};

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
//
// It also decides which screen the person is on (gate.js): an account is
// required, so without one they see the landing page and then the sign-in page,
// and the home screen and any project are for signed-in people only (a shared
// read-only link is the one exception, since it is public by design).
export class PandemoniumApp extends LitElement {
  static properties = {
    // False until the session has been restored, so a signed-in person is never
    // shown the landing page for the moment it takes to find out they are.
    _booted: { state: true },
    _path: { state: true },
  };

  static styles = [formStyles, chipStyles, css`
    :host{display:block;height:100%}
    .app{height:100%;display:flex;flex-direction:column}
    #toastHost,#dialogHost{position:fixed;inset:0;pointer-events:none;z-index:90}
    /* Shown while the session is restored. Nothing on it can be wrong. */
    .boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(180deg,var(--scrim-a) 0%,var(--scrim-b) 100%)}
    .boot pd-logo{font-size:27.612px;color:var(--res);opacity:.6}
  `];

  #debouncedAutosave;

  constructor() {
    super();
    this._booted = false;
    this._path = location.pathname;
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
    this.addEventListener('pandemonium-show-link-popover', (e) => this.renderRoot.getElementById('linkPopover').open(e.detail));
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
    // Account state (signed in/out) changes which screen shows and what the
    // topbar offers; re-render on it as well as on store changes. Signing in
    // from the sign-in page leaves it for the address the person actually wants.
    session.addEventListener('change', () => {
      if (session.isAuthed() && isLoginPath(this._path)) this.#navigate('/', { replace: true });
      this.requestUpdate();
    });
    this.addEventListener('pandemonium-navigate', (e) => this.#navigate(e.detail.path));
    this.addEventListener('pandemonium-sign-out', () => this.#signOut());
    window.addEventListener('popstate', this.#onPopState);
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
  // then, only if there is one, load the last cloud project. Without an account
  // nothing is loaded at all: the browser-local project a signed-out visit used
  // to restore is not opened any more (it is offered to the account from the
  // home screen instead, see start-screen.js). A share link in the URL takes
  // over the whole boot instead. Either way the gate opens when this is done.
  async #boot() {
    try {
      if (await this.#bootSharedView()) return;
      await session.restore().catch(() => {});
      if (!session.isAuthed()) return;
      try {
        const project = await loadAutosavedProject();
        if (project && !this.store.project) this.store.loadProject(project);
      } catch (err) {
        console.warn('Could not restore a project:', err);
      }
    } finally {
      this._booted = true;
    }
  }

  // The address bar. The app is one page with two public addresses: / (the
  // landing page) and /login. Everything signed in happens at / as before. This
  // keeps the browser's Back button meaning what people expect on the way in.
  #navigate(path, { replace = false } = {}) {
    if (location.pathname !== path) {
      if (replace) history.replaceState({}, '', path);
      else history.pushState({}, '', path);
    }
    this._path = path;
  }

  #onPopState = () => { this._path = location.pathname; };

  // Leaving the account: the open project is saved to it first (while it is still
  // reachable), then the session ends and the landing page shows, then the
  // project is closed. In that order so the person goes straight from their work
  // to the landing page: closing first would show the home screen for as long as
  // the sign-out request takes, and the gate never shows a project to someone
  // who is not signed in (see gate.js), so it is hidden the moment the session
  // ends. The browser-local slot is deliberately not touched, and nothing is
  // written to it: the project just left must not end up sitting in it.
  async #signOut() {
    await this.#flushAutosave();
    if (this.store.ui && this.store.ui.merge) return; // see #openRemoteProject
    await session.logout();
    this.store.closeProject();
    this.#navigate('/', { replace: true });
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
  // first." The save reaches the account (a shared read-only view never gets
  // here with anything to save).
  async #flushAutosave() {
    this.#debouncedAutosave.cancel();
    // A shared read-only view is a visitor's copy of someone else's script: it is
    // never saved anywhere, or it would land in this browser's local slot and be
    // offered back later as "a project from before accounts".
    if (!this.store.project || this._sharedView) return;
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
    window.removeEventListener('popstate', this.#onPopState);
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

  #screen() {
    return screenFor({
      booted: this._booted,
      hasProject: !!this.store.project,
      sharedView: !!this._sharedView,
      authed: session.isAuthed(),
      path: this._path,
    });
  }

  // The panels are tracked by the store (a project's own views); the screens
  // outside a project are tracked here, once each time the screen changes.
  updated() {
    const screen = this.#screen();
    if (screen === this._lastScreen) return;
    this._lastScreen = screen;
    const view = SCREEN_VIEWS[screen];
    if (view) trackVirtualView(view.title, { page_path: view.path });
  }

  render() {
    const screen = this.#screen();
    return html`
      ${screen === 'app' ? html`
        <div class="app">
          <pandemonium-topbar></pandemonium-topbar>
          <pandemonium-panel-layout></pandemonium-panel-layout>
        </div>
      ` : screen === 'start' ? html`<pandemonium-start-screen></pandemonium-start-screen>`
        : screen === 'landing' ? html`<pandemonium-landing></pandemonium-landing>`
        : screen === 'login' ? html`<pandemonium-login></pandemonium-login>`
        : html`<div class="boot"><pd-logo></pd-logo></div>`}
      <pd-toast id="toast"></pd-toast>
      <pd-dialog id="dialog" data-clarity-mask="true"></pd-dialog>
      <pd-menu id="menu"></pd-menu>
      <pandemonium-selection-toolbar id="selToolbar"></pandemonium-selection-toolbar>
      <pandemonium-linkbar data-clarity-mask="true"></pandemonium-linkbar>
      <pandemonium-link-popover id="linkPopover" data-clarity-mask="true"></pandemonium-link-popover>
      <pandemonium-comment-popover id="commentPopover" data-clarity-mask="true"></pandemonium-comment-popover>
      <pandemonium-slideshow id="slideshow" data-clarity-mask="true"></pandemonium-slideshow>
      <pd-account-dialog id="accountDialog" data-clarity-mask="true"></pd-account-dialog>
      <pd-merge-dialog data-clarity-mask="true"></pd-merge-dialog>
      <pd-share-dialog id="shareDialog" data-clarity-mask="true"></pd-share-dialog>
      ${BETA ? html`<pd-bug-report-dialog id="bugReport"></pd-bug-report-dialog>` : ''}
    `;
  }
}

customElements.define('pandemonium-app', PandemoniumApp);

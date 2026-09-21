'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { emptyProject } from '../data/schema.js';
import { openProjectFile, peekLocalProject, adoptLocalProject } from '../data/db.js';
import { hasWork } from '../data/project-model.js';
import { session } from '../data/session.js';
import { listProjectsRemote } from '../data/remote-api-adapter.js';
import { dispatch } from '../utils/events.js';
import { initialsOf } from '../utils/initials.js';
import { avatarStyles } from '../styles/shared.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';
import '../components/ui/project-card.js';

// Home. Figma "Create New Project" (node 7:88, frame 1280x832) for the
// create column; the recent-projects row beneath it is new. The frame's
// fixed y positions become a centered column with the measured gaps between
// blocks and a footer pinned to the bottom, which reproduces the frame at
// 832px tall and degrades sensibly at other viewport heights. The
// clapperboard card itself is <pd-project-card>, shared with the project
// settings dialog; the recent tiles are the same component in `compact
// closed` mode.
//
// This screen is only reached signed in: an account is required (see gate.js),
// so there is no signed-out form of it. Recents are the account's own cloud
// projects (listProjectsRemote, the same list the account dialog's picker uses),
// each a clapperboard with just its name and workspace written on it. The row
// honestly distinguishes "no projects yet" from "could not load them"
// (_recentsError) rather than collapsing a failed fetch into looking like an
// empty account, which would silently misreport a connection problem as "you
// have nothing here." The account itself (its projects, sign out) is the badge
// at the top right.
//
// One more thing can appear here: a project left in this browser from before
// accounts were required. Those people signed in to find their work gone from
// view, so it is offered back, once, to be added to the account (_local).
export class PandemoniumStartScreen extends LitElement {
  static properties = { _recents: { state: true }, _recentsError: { state: true }, _local: { state: true }, _adopting: { state: true } };

  static styles = [avatarStyles, css`
    :host{
      position:fixed;inset:0;z-index:60;
      background:linear-gradient(180deg,var(--scrim-a) 0%,var(--scrim-b) 100%);
      font-family:var(--sans);
      display:flex;flex-direction:column;align-items:center;
      overflow:auto;
    }
    /* flex:none is load-bearing. As a shrinkable flex item the stage was
       squashed below its content height on a short viewport, which is what
       drove the clapperboard down into the buttons instead of scrolling. */
    .stage{
      position:relative;
      box-sizing:border-box;
      flex:none;min-height:100%;width:100%;
      padding:41.21px 0 26px;
      display:flex;flex-direction:column;align-items:center;
    }

    /* Wordmark. 356.33 x 27.61 in Figma; the logo svg is height-driven. */
    pd-logo{font-size:27.612px;color:var(--res)}

    .tagline{
      margin-top:15.18px;
      font-size:14.277px;line-height:17.434px;
      text-align:center;color:var(--ink);
    }

    /* Scoped to the create card specifically: a bare pd-project-card selector
       would also catch the compact recent tiles below and shove each of them
       down 134px inside their row. */
    #newCard{margin-top:134px;flex:none}

    /* "Open" is not on the Figma frame, but opening a saved project is the
       only other way into the app, so it sits beside the primary action in
       the same Button-Standard treatment. */
    .actions{margin-top:22px;flex:none;display:flex;align-items:center;gap:8px}

    /* The account: its projects, and signing out. Where the title bar keeps it. */
    .acct{position:absolute;top:12px;right:21px}

    /* The project from before accounts. A quiet flat panel, not an alert: the
       work is safe where it is until they choose to move it. */
    .local{
      margin-top:18px;flex:none;max-width:min(560px,92vw);box-sizing:border-box;
      display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 12px;
      padding:10px 16px;border-radius:20px;background:var(--panel);
      font-size:12px;line-height:1.4;color:var(--ink);text-align:center;
    }
    .local b{font-weight:600}

    .recents{margin-top:52px;flex:none;width:min(760px,92vw);display:flex;flex-direction:column;align-items:center;gap:16px}
    .recents-h{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);opacity:.7}
    /* The gaps are sized for a hovered tile: its 8dp shadow reaches about 14px
       to the sides and 16px below at this scale, so neighbours stay clear of it. */
    .recents-row{display:flex;flex-wrap:wrap;justify-content:center;gap:32px 38px}
    .recents-msg{font-size:12px;color:var(--ink);opacity:.6;text-align:center}

    .foot{
      margin-top:auto;padding-top:40px;flex:none;
      font-size:13.277px;line-height:17.434px;color:var(--ink);text-align:center;
    }
    .foot i{font-style:italic}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._recents = null; // null while loading
    this._recentsError = false;
    this._local = null; // a project left in this browser, if it holds any work
    this._adopting = false;
    this._onSession = () => this.#onSessionChange();
  }

  connectedCallback() {
    super.connectedCallback();
    session.addEventListener('change', this._onSession);
    if (session.isAuthed()) { this.#loadRecents(); this.#checkLocal(); }
  }

  disconnectedCallback() {
    session.removeEventListener('change', this._onSession);
    super.disconnectedCallback();
  }

  #onSessionChange() {
    if (session.isAuthed()) { this.#loadRecents(); this.#checkLocal(); }
    else { this._recents = null; this._recentsError = false; this._local = null; }
    this.requestUpdate();
  }

  async #checkLocal() {
    try {
      const p = await peekLocalProject();
      this._local = hasWork(p) ? p : null;
    } catch {
      this._local = null;
    }
  }

  // Add it to the account, and only then open it. adoptLocalProject leaves the
  // browser copy untouched if the upload fails, so a failure costs nothing.
  async #adoptLocal() {
    const project = this._local;
    if (!project || this._adopting) return;
    this._adopting = true;
    try {
      await adoptLocalProject(project);
      this._local = null;
      this._store.store.loadProject(project);
    } catch (err) {
      dispatch(this, 'pandemonium-toast', { message: 'Could not add it to your account. It is still saved in this browser.' });
    } finally {
      this._adopting = false;
    }
  }

  async #loadRecents() {
    this._recents = null;
    this._recentsError = false;
    try {
      this._recents = await listProjectsRemote();
    } catch (err) {
      this._recentsError = true;
    }
  }

  #card() {
    return this.renderRoot.getElementById('newCard');
  }

  #create() {
    const v = this.#card().read();
    this._store.store.loadProject(emptyProject({ ...v, name: v.name || 'Untitled Project' }));
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

  // Same event the account dialog's own project list dispatches: app-root
  // owns cancelling the outgoing autosave and adopting the loaded project, so
  // this screen does not need to know how to open a remote project itself.
  #openRecent(id) {
    dispatch(this, 'pandemonium-open-remote-project', { id });
  }

  render() {
    const user = session.getUser();
    return html`
      <div class="stage">
        <div class="acct">
          <button class="avatar" data-clarity-mask="true" @click=${() => dispatch(this, 'pandemonium-open-account', {})}
            title="Your account and cloud projects" aria-label="Your account">${initialsOf(user)}</button>
        </div>

        <pd-logo></pd-logo>
        <div class="tagline">
          A tool for creators &amp; filmmakers to<br>
          manage and streamline pre-production
        </div>

        <pd-project-card id="newCard" data-clarity-mask="true"></pd-project-card>

        <div class="actions">
          <pd-button @click=${() => this.#create()}>Create Project</pd-button>
          <pd-button @click=${() => this.renderRoot.getElementById('fileOpen').click()}>Open</pd-button>
        </div>

        ${this._local ? html`
          <div class="local" data-clarity-mask="true">
            <span>A project from before accounts is saved in this browser: <b>${this._local.name || 'Untitled'}</b>.</span>
            <pd-button variant="act" ?disabled=${this._adopting} @click=${() => this.#adoptLocal()}>
              ${this._adopting ? 'Adding...' : 'Add to my account'}
            </pd-button>
            <pd-button variant="ghost" @click=${() => { this._local = null; }}>Not now</pd-button>
          </div>
        ` : ''}

        <div class="recents">
          <div class="recents-h">Recent projects</div>
          ${this._recentsError
            ? html`<div class="recents-msg">Could not load your recent projects. Check your connection and reopen this screen to retry.</div>`
            : this._recents === null
              ? html`<div class="recents-msg">Loading…</div>`
              : this._recents.length === 0
                ? html`<div class="recents-msg">No cloud projects yet. Anything you create will show up here.</div>`
                : html`<div class="recents-row" data-clarity-mask="true">
                    ${this._recents.map((p) => html`
                      <pd-project-card compact closed .scale=${0.85}
                        .projectName=${p.name || 'Untitled'} .workspace=${p.workspace || ''}
                        @click=${() => this.#openRecent(p.id)}></pd-project-card>
                    `)}
                  </div>`}
        </div>

        <div class="foot">A Project by <i>Common Genius</i></div>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
    `;
  }
}

customElements.define('pandemonium-start-screen', PandemoniumStartScreen);

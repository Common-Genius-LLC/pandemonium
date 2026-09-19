'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { emptyProject } from '../data/schema.js';
import { openProjectFile } from '../data/db.js';
import { session } from '../data/session.js';
import { listProjectsRemote } from '../data/remote-api-adapter.js';
import { dispatch } from '../utils/events.js';
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
// Recents are cloud projects only: signed-in users already have a real,
// server-backed project list (listProjectsRemote, the same one the account
// dialog's picker uses); local/signed-out projects are a single
// browser-resident slot with no history to list, so there is nothing honest
// to show there yet (see local-db.js). Signed-out users just see Create/Open,
// no row at all. Signed-in users always see the row once a load attempt has
// settled, honestly distinguishing "no projects yet" from "could not load
// them" (_recentsError) rather than collapsing a failed fetch into looking
// like an empty account, which would silently misreport a connection problem
// as "you have nothing here."
export class PandemoniumStartScreen extends LitElement {
  static properties = { _recents: { state: true }, _recentsError: { state: true } };

  static styles = css`
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

    .recents{margin-top:52px;flex:none;width:min(760px,92vw);display:flex;flex-direction:column;align-items:center;gap:16px}
    .recents-h{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);opacity:.7}
    .recents-row{display:flex;flex-wrap:wrap;justify-content:center;gap:22px 26px}
    .recents-msg{font-size:12px;color:var(--ink);opacity:.6;text-align:center}

    .foot{
      margin-top:auto;padding-top:40px;flex:none;
      font-size:13.277px;line-height:17.434px;color:var(--ink);text-align:center;
    }
    .foot i{font-style:italic}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._recents = null; // null = signed out, or signed in and still loading
    this._recentsError = false;
    this._onSession = () => this.#onSessionChange();
  }

  connectedCallback() {
    super.connectedCallback();
    session.addEventListener('change', this._onSession);
    if (session.isAuthed()) this.#loadRecents();
  }

  disconnectedCallback() {
    session.removeEventListener('change', this._onSession);
    super.disconnectedCallback();
  }

  #onSessionChange() {
    if (session.isAuthed()) this.#loadRecents();
    else { this._recents = null; this._recentsError = false; }
    this.requestUpdate();
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
    return html`
      <div class="stage">
        <pd-logo></pd-logo>
        <div class="tagline">
          A tool for creators &amp; filmmakers to<br>
          manage and streamline pre-production
        </div>

        <pd-project-card id="newCard" data-clarity-mask="true"></pd-project-card>

        <div class="actions">
          <pd-button @click=${() => this.#create()}>Create Project</pd-button>
          <pd-button @click=${() => this.renderRoot.getElementById('fileOpen').click()}>Open</pd-button>
          ${session.isAuthed()
            ? html`<pd-button @click=${() => dispatch(this, 'pandemonium-open-account', {})}>Open from cloud</pd-button>`
            : html`<pd-button variant="pink" @click=${() => dispatch(this, 'pandemonium-open-account', {})}>Sign in</pd-button>`}
        </div>

        ${session.isAuthed() ? html`
          <div class="recents">
            <div class="recents-h">Recent projects</div>
            ${this._recentsError
              ? html`<div class="recents-msg">Could not load your recent projects. Check your connection and reopen this screen to retry.</div>`
              : this._recents === null
                ? html`<div class="recents-msg">Loading…</div>`
                : this._recents.length === 0
                  ? html`<div class="recents-msg">No cloud projects yet. Anything you create while signed in will show up here.</div>`
                  : html`<div class="recents-row" data-clarity-mask="true">
                      ${this._recents.map((p) => html`
                        <pd-project-card compact closed .scale=${0.62}
                          .projectName=${p.name || 'Untitled'} .workspace=${p.workspace || ''}
                          @click=${() => this.#openRecent(p.id)}></pd-project-card>
                      `)}
                    </div>`}
          </div>
        ` : ''}

        <div class="foot">A Project by <i>Common Genius</i></div>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
    `;
  }
}

customElements.define('pandemonium-start-screen', PandemoniumStartScreen);

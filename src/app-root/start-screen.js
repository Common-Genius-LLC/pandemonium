'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { emptyProject } from '../data/schema.js';
import { openProjectFile } from '../data/db.js';
import { session } from '../data/session.js';
import { dispatch } from '../utils/events.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';
import '../components/ui/project-card.js';

// Figma "Create New Project" (node 7:88, frame 1280x832). The frame's fixed y
// positions become a centered column with the measured gaps between blocks and
// a footer pinned to the bottom, which reproduces the frame at 832px tall and
// degrades sensibly at other viewport heights. The clapperboard card itself is
// <pd-project-card>, shared with the project settings dialog.
export class PandemoniumStartScreen extends LitElement {
  static styles = css`
    :host{
      position:fixed;inset:0;z-index:60;
      background:linear-gradient(180deg,#ffffff 0%,#d8d8d8 100%);
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
      text-align:center;color:#000;
    }

    pd-project-card{margin-top:134px;flex:none}

    /* "Open" is not on the Figma frame, but opening a saved project is the
       only other way into the app, so it sits beside the primary action in
       the same Button-Standard treatment. */
    .actions{margin-top:22px;flex:none;display:flex;align-items:center;gap:8px}

    .foot{
      margin-top:auto;padding-top:40px;flex:none;
      font-size:13.277px;line-height:17.434px;color:#000;text-align:center;
    }
    .foot i{font-style:italic}
  `;

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

  #card() {
    return this.renderRoot.querySelector('pd-project-card');
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

  render() {
    return html`
      <div class="stage">
        <pd-logo></pd-logo>
        <div class="tagline">
          A tool for creators &amp; filmmakers to<br>
          manage and streamline pre-production
        </div>

        <pd-project-card></pd-project-card>

        <div class="actions">
          <pd-button @click=${() => this.#create()}>Create Project</pd-button>
          <pd-button @click=${() => this.renderRoot.getElementById('fileOpen').click()}>Open</pd-button>
          ${session.isAuthed()
            ? html`<pd-button @click=${() => dispatch(this, 'pandemonium-open-account', {})}>Open from cloud</pd-button>`
            : html`<pd-button variant="pink" @click=${() => dispatch(this, 'pandemonium-open-account', {})}>Sign in</pd-button>`}
        </div>

        <div class="foot">A Project by <i>Common Genius</i></div>
      </div>
      <input type="file" id="fileOpen" accept=".json,application/json" style="display:none" @change=${(e) => this.#openFile(e)}>
    `;
  }
}

customElements.define('pandemonium-start-screen', PandemoniumStartScreen);

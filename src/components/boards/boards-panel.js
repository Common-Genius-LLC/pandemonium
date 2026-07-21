'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './board-card.js';

// "+ Add storyboard image" opens the file picker immediately -- no
// prerequisite step. It used to require selecting a script passage first
// (arming a "pick a passage" mode and waiting for a selection elsewhere),
// which was the actual source of "I have no idea how to upload a
// thumbnail": the button didn't visibly do anything until you went and
// found more UI in a different panel. Now it just uploads, and the
// resulting board is created unattached (anchor.parts: []) -- the exact
// same state a board ends up in when its passage can no longer be found,
// so it renders as "unlinked" with a "Reattach" button already built for
// this, and you attach it to a passage whenever you like, from a normal
// text selection or not at all.
export class PandemoniumBoardsPanel extends LitElement {
  static properties = { leafId: {} };

  static styles = [panelStyles, css`
    #boardsList{display:flex;flex-direction:column;gap:16px;padding:2px 10px 30px 2px}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #title() {
    return html`<pd-panel-picker current="boards" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  #addBoard() {
    const input = this.renderRoot.getElementById('fileImg');
    input.value = '';
    input.click();
  }

  #startSlideshow() {
    dispatch(this, 'pandemonium-open-slideshow', {});
  }

  async #onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const img = await readFileAsDataURL(file);
    this._store.store.addBoard({ parts: [], img, caption: '' });
    dispatch(this, 'pandemonium-toast', { message: 'Board added. Select a script passage anytime to attach it.' });
  }

  updated() {
    const ui = this._store.ui;
    if (!ui || !ui.highlightBoard) return;
    const id = ui.highlightBoard;
    this._store.store.setUI({ highlightBoard: null });
    requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector(`pandemonium-board-card[data-board-id="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.style.outline = '2px solid var(--board)';
      setTimeout(() => { card.style.outline = ''; }, 1200);
    });
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    const state = this._store.store.getFinalState();
    const arr = state.R.boards.slice().sort((a, b) => a.firstBi - b.firstBi);
    return html`
      <div class="phead">
        ${this.#title()}<span class="sub">for the final draft</span>
        <div class="tools">
          <pd-button variant="pink" title="Play the linked storyboards full-screen" @click=${() => this.#startSlideshow()}>Start slideshow</pd-button>
          <pd-button @click=${() => this.#addBoard()}>+ Add storyboard image</pd-button>
        </div>
      </div>
      <div class="pbody">
        <div id="boardsList">
          ${arr.length
            ? arr.map((o) => html`<pandemonium-board-card .resolved=${o} .sceneLabel=${o.ok ? state.fscenes[o.sceneIdx].label : ''}></pandemonium-board-card>`)
            : html`<div class="empty">No boards yet. Click <b>+ Add storyboard image</b>, paste an image, or select a passage in the script and choose <b>Board</b>.</div>`}
        </div>
      </div>
      <input type="file" id="fileImg" accept="image/*" style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }
}

customElements.define('pandemonium-boards-panel', PandemoniumBoardsPanel);

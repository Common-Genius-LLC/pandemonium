'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import './board-card.js';

// "+ Add storyboard image" is the always-visible entry point that used to
// not exist: previously the only way to attach a board was to already be in
// the script preview, select text, and find the floating toolbar's "Board"
// action -- undiscoverable, and impossible while the script was in Edit
// mode or on a non-final draft. Clicking it now arms ui.pendingRelink as
// {type:'new-board'} and prompts the user to select a script passage; the
// script panel (src/components/editor/script-panel.js) checks for that type
// on the next selection and opens the file picker itself.
export class PandemoniumBoardsPanel extends LitElement {
  static styles = [panelStyles, css`
    #boardsList{display:flex;flex-direction:column;gap:16px;padding:2px 10px 30px 2px}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #setSplit(which) {
    this._store.store.setUI({ view: 'split', split: which, pair: null });
  }

  #addBoard() {
    const store = this._store.store;
    store.setUI({ pendingRelink: { type: 'new-board' }, draftId: store.finalScript().id, edit: false, view: store.ui.view === 'single' ? 'everything' : store.ui.view });
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
        <span class="lbl">Thumbnails</span><span class="sub">for the final draft</span>
        <div class="tools">
          <pd-button @click=${() => this.#addBoard()}>+ Add storyboard image</pd-button>
          <div class="mode">
            <button class=${ui.split === 'boards' ? 'on' : ''} @click=${() => this.#setSplit('boards')}>Boards</button>
            <button class=${ui.split === 'research' ? 'on' : ''} @click=${() => this.#setSplit('research')}>Research</button>
          </div>
        </div>
      </div>
      <div class="pbody">
        <div id="boardsList">
          ${arr.length
            ? arr.map((o) => html`<pandemonium-board-card .resolved=${o} .sceneLabel=${o.ok ? state.fscenes[o.sceneIdx].label : ''}></pandemonium-board-card>`)
            : html`<div class="empty">No boards yet. Click <b>+ Add storyboard image</b>, or select a passage in the script and choose <b>Board</b>.</div>`}
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-boards-panel', PandemoniumBoardsPanel);

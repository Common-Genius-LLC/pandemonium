'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './board-card.js';

// "Add Image" opens the file picker immediately -- no
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
    .pbody.over{outline:2px solid var(--res);outline-offset:-2px}
    #boardsList{display:flex;flex-direction:column;gap:16px;padding:10px 10px 30px}
    /* Figma "Frame 4" (node 19:330): the illustration over the pane's own
       pink, with the drop invitation beneath it, centered in the empty pane. */
    .noboards{
      height:100%;min-height:200px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    }
    .noboards img{width:440px;max-width:78%;height:auto;display:block;pointer-events:none}
    .noboards p{
      width:250px;max-width:70%;margin:0;text-align:center;
      font-size:14px;line-height:18px;color:var(--pane-board-ink);
    }
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
    await this.#addImages(e.target.files || []);
  }

  // The empty pane invites a drop, so the pane has to accept one. Same
  // unattached board a picked file produces, one per image dropped.
  async #addImages(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    for (const file of images) {
      const img = await readFileAsDataURL(file);
      this._store.store.addBoard({ parts: [], img, caption: '' });
    }
    dispatch(this, 'pandemonium-toast', {
      message: images.length === 1
        ? 'Board added. Select a script passage anytime to attach it.'
        : images.length + ' boards added. Select a script passage anytime to attach them.',
    });
  }

  #onDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('over');
  }

  #onDragLeave(e) {
    e.currentTarget.classList.remove('over');
  }

  async #onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('over');
    await this.#addImages(e.dataTransfer.files || []);
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
      <div class="shell" style="--pane-bg:var(--pane-board)">
        <div class="chrome">
          ${this.#title()}
          <div class="tools">
            <pd-button variant="pink" title="Play the linked storyboards full-screen" @click=${() => this.#startSlideshow()}>Start slideshow</pd-button>
            <pd-button @click=${() => this.#addBoard()}>Add Image</pd-button>
          </div>
        </div>
        <div class="pbody"
          @dragover=${(e) => this.#onDragOver(e)}
          @dragleave=${(e) => this.#onDragLeave(e)}
          @drop=${(e) => this.#onDrop(e)}>
          ${arr.length
            ? html`<div id="boardsList">
                ${arr.map((o) => html`<pandemonium-board-card .resolved=${o} .sceneLabel=${o.ok ? state.fscenes[o.sceneIdx].label : ''}></pandemonium-board-card>`)}
              </div>`
            : html`<div class="noboards">
                <img src="/boards-empty.png" alt="">
                <p>drop images here to use as storyboard panels</p>
              </div>`}
        </div>
      </div>
      <input type="file" id="fileImg" accept="image/*" multiple style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }
}

customElements.define('pandemonium-boards-panel', PandemoniumBoardsPanel);

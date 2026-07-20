'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL } from '../../utils/files.js';
import '../../components/ui/button.js';

// One storyboard card. `resolved` is the {bd, res, ok, sceneIdx} entry from
// store.getFinalState().R.boards -- the card itself never resolves anchors,
// it just renders what the panel already computed.
export class PandemoniumBoardCard extends LitElement {
  static properties = { resolved: { type: Object }, sceneLabel: { type: String } };

  static styles = css`
    :host{display:block}
    .bcard{border-radius:var(--r);overflow:hidden;background:var(--panel)}
    .bcard.lost .meta{background:var(--warn)}
    .img{aspect-ratio:16/9;background:var(--ph);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden}
    .img img{width:100%;height:100%;object-fit:cover;display:block}
    .meta{padding:8px 10px;display:flex;flex-direction:column;gap:4px}
    .top{display:flex;align-items:center;gap:8px}
    .sc{font-size:9px;font-weight:500;letter-spacing:.08em;color:var(--mut);text-transform:uppercase;white-space:nowrap}
    /* The linked section text IS the caption now (notes.md point d), so it is
       the card's main descriptor rather than a free-text field. */
    .quote{font-family:var(--mono);font-size:11px;color:var(--ui);line-height:1.4;cursor:pointer;
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .bcard.lost .quote{color:var(--mut);font-family:var(--sans);font-style:italic;cursor:default}
    .ops{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
    .ops button{font-size:10px;color:var(--ui);padding:3px 8px;background:var(--bg);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
    .ops button:hover{background:var(--ph)}
    .ops button.del:hover{background:var(--danger);color:#fff}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  // Read directly by boards-panel to scroll/outline a card the highlight
  // popover asked to reveal (ui.highlightBoard) -- see boards-panel.js.
  updated() {
    if (this.resolved) this.setAttribute('data-board-id', this.resolved.bd.id);
  }

  #jump() {
    const store = this._store.store;
    const fsc = store.getFinalState().fsc;
    const r = this.resolved.res.find(Boolean);
    const patch = {};
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    if (r) patch.scrollToBlock = r.bi;
    store.setUI(patch);
  }

  #relink() {
    const store = this._store.store;
    store.setUI({ pendingRelink: { type: 'board', id: this.resolved.bd.id }, draftId: store.finalScript().id });
  }

  async #pickImage(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    this._store.store.replaceBoardImage(this.resolved.bd.id, dataUrl);
    dispatch(this, 'pandemonium-toast', { message: 'Image replaced.' });
  }

  #delete() {
    if (!confirm('Delete this board? This removes the image too.')) return;
    this._store.store.deleteBoard(this.resolved.bd.id);
  }

  // Detach from the script without deleting the image: the board becomes an
  // "unlinked" board (anchor.parts: []), exactly like a freshly pasted image,
  // and can be re-attached later from its Attach button or a section's Board.
  #unlink() {
    this._store.store.reattachBoard(this.resolved.bd.id, []);
    dispatch(this, 'pandemonium-toast', { message: 'Board unlinked from the script. The image is kept.' });
  }

  render() {
    const o = this.resolved;
    const bd = o.bd;
    const q = ((bd.anchor.parts[0] && bd.anchor.parts[0].q) || '').slice(0, 120);
    const tag = o.ok ? (this.sceneLabel === 'OP' ? 'OPEN' : 'SC ' + this.sceneLabel) : 'unlinked';
    return html`
      <div class="bcard ${o.ok ? '' : 'lost'}">
        <div class="img" title=${o.ok ? 'Go to the linked section in the script' : ''} @click=${() => o.ok && this.#jump()}>${bd.img ? html`<img alt="" src=${bd.img}>` : ''}</div>
        <div class="meta">
          <div class="top"><span class="sc">${tag}</span></div>
          <div class="quote" title="The board's caption is the script section it's linked to" @click=${() => o.ok && this.#jump()}>
            ${o.ok ? (q || '(linked section)') : 'Not linked to the script yet.'}
          </div>
          <div class="ops">
            ${o.ok
              ? html`
                <button title="Scroll the script to this board's section" @click=${() => this.#jump()}>Go to script</button>
                <button title="Detach this board from the script. The image is kept and can be re-attached later." @click=${() => this.#unlink()}>Unlink</button>`
              : html`<button title="Attach this board to the script: click, then select a passage (or use a section's Board button)" @click=${() => this.#relink()}>Attach to script</button>`}
            <button title="Replace this board's image" @click=${() => this.renderRoot.querySelector('input[type=file]').click()}>Replace image</button>
            <button class="del" title="Delete this board and its image" @click=${() => this.#delete()}>Delete</button>
          </div>
        </div>
      </div>
      <input type="file" accept="image/*" style="display:none" @change=${(e) => this.#pickImage(e)}>
    `;
  }
}

customElements.define('pandemonium-board-card', PandemoniumBoardCard);

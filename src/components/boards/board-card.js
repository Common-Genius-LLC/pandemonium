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
    input.cap{
      background:transparent;padding:0;font-size:12px;color:var(--ink);flex:1;min-width:0;
      border-radius:0;border:0;font-family:var(--sans);height:auto;
    }
    .quote{font-family:var(--mono);font-size:10px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
    .quote:hover{color:var(--ui)}
    .ops{display:flex;gap:2px;margin-left:auto}
    .ops button{font-size:10px;color:var(--mut);padding:2px 5px;background:none;border:0;border-radius:2px;cursor:pointer;font-family:var(--sans)}
    .ops button:hover{color:var(--ui);background:var(--ph)}
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
    const patch = { edit: false };
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    if (r) patch.scrollToBlock = r.bi;
    store.setUI(patch);
  }

  #relink() {
    const store = this._store.store;
    store.setUI({ pendingRelink: { type: 'board', id: this.resolved.bd.id }, draftId: store.finalScript().id, edit: false });
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
    if (!confirm('Remove this board?')) return;
    this._store.store.deleteBoard(this.resolved.bd.id);
  }

  #caption(e) {
    this._store.store.updateBoardCaption(this.resolved.bd.id, e.target.value);
  }

  render() {
    const o = this.resolved;
    const bd = o.bd;
    const q = ((bd.anchor.parts[0] && bd.anchor.parts[0].q) || '').slice(0, 120);
    const tag = o.ok ? (this.sceneLabel === 'OP' ? 'OPEN' : 'SC ' + this.sceneLabel) : 'unlinked';
    return html`
      <div class="bcard ${o.ok ? '' : 'lost'}">
        <div class="img" @click=${() => this.#jump()}>${bd.img ? html`<img alt="" src=${bd.img}>` : ''}</div>
        <div class="meta">
          <div class="top">
            <span class="sc">${tag}</span>
            <input class="cap" placeholder="Caption" .value=${bd.caption || ''} @input=${(e) => this.#caption(e)}>
            <div class="ops">
              ${o.ok
                ? html`<button @click=${() => this.#jump()}>Script</button>`
                : html`<button @click=${() => this.#relink()}>Reattach</button>`}
              <button @click=${() => this.renderRoot.querySelector('input[type=file]').click()}>Image</button>
              <button title="Remove board" @click=${() => this.#delete()}>×</button>
            </div>
          </div>
          <div class="quote" @click=${() => this.#jump()}>${q}</div>
        </div>
      </div>
      <input type="file" accept="image/*" style="display:none" @change=${(e) => this.#pickImage(e)}>
    `;
  }
}

customElements.define('pandemonium-board-card', PandemoniumBoardCard);

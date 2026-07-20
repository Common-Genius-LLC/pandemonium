'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { clamp } from '../../utils/format.js';

// The small popover that appears when clicking a board highlight inside the
// script (not a research link -- those open a pair + connector instead).
// Opened via `pandemonium-show-board-popover` with {boardId, anchor}.
export class PandemoniumHighlightPopover extends LitElement {
  static properties = { _open: { state: true }, _board: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    .pop{position:fixed;width:250px;background:var(--panel);border-radius:var(--r);overflow:hidden;pointer-events:auto;font-family:var(--sans)}
    .img{aspect-ratio:16/9;background:var(--ph);overflow:hidden}
    .img img{width:100%;height:100%;object-fit:cover;display:block}
    .meta{padding:8px 10px;display:flex;align-items:center;gap:8px;font-size:11px}
    .cap{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
    button{height:24px;padding:0 10px;background:var(--bg);color:var(--ui);font-size:11px;font-weight:500;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
    button:hover{background:var(--ph)}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
    this._anchor = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocDown = (e) => {
      if (!this._open) return;
      if (this._anchor && e.composedPath().includes(this._anchor)) return;
      if (e.composedPath().includes(this)) return;
      this.close();
    };
    document.addEventListener('mousedown', this._onDocDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    super.disconnectedCallback();
  }

  open({ boardId, anchor }) {
    const board = this._store.project.boards.find((b) => b.id === boardId);
    if (!board) return;
    this._board = board;
    this._anchor = anchor;
    this._open = true;
    this.updateComplete.then(() => this.#position());
  }

  close() { this._open = false; this._anchor = null; }

  #position() {
    if (!this._anchor) return;
    const pop = this.renderRoot.querySelector('.pop');
    if (!pop) return;
    const r = this._anchor.getBoundingClientRect();
    this._x = clamp(r.left, 8, innerWidth - pop.offsetWidth - 8);
    this._y = clamp(r.bottom + 8, 8, innerHeight - pop.offsetHeight - 8);
  }

  #openInBoards() {
    const store = this._store.store;
    const patch = { highlightBoard: this._board.id };
    if (store.ui.view === 'single') { patch.view = 'split'; patch.split = 'boards'; }
    else if (store.ui.view === 'split' && store.ui.split !== 'boards') { patch.split = 'boards'; }
    store.setUI(patch);
    this.close();
  }

  render() {
    if (!this._open) return html``;
    const bd = this._board;
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <div class="img">${bd.img ? html`<img alt="" src=${bd.img}>` : ''}</div>
        <div class="meta"><span class="cap">${bd.caption || 'Storyboard panel'}</span><button @click=${() => this.#openInBoards()}>Boards</button></div>
      </div>
    `;
  }
}

customElements.define('pandemonium-highlight-popover', PandemoniumHighlightPopover);

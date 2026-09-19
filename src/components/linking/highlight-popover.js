'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { clamp } from '../../utils/format.js';
import { frameImg } from '../../data/project-model.js';

// The small popover that appears when clicking a board highlight inside the
// script (not a research link -- those open a pair + connector instead).
// Opened via `pandemonium-show-board-popover` with {boardId, anchor}.
export class PandemoniumHighlightPopover extends LitElement {
  static properties = { _open: { state: true }, _board: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    @keyframes pop-in{from{opacity:0;transform:translateY(-4px)}}
    .pop{animation:pop-in var(--dur-1) var(--ease-out);position:fixed;width:250px;background:var(--panel);border-radius:var(--r);overflow:hidden;pointer-events:auto;font-family:var(--sans)}
    .img{aspect-ratio:16/9;background:var(--ph);overflow:hidden;cursor:pointer}
    .img img{width:100%;height:100%;object-fit:cover;display:block}
    .pnote{height:100%;box-sizing:border-box;padding:10px 12px;font-size:12px;line-height:1.35;color:var(--ink);overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
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
    // Reveals the board wherever a Thumbnails pane is visible (window-division
    // layout has no single/split modes to switch into).
    // Show the view that has this storyboard's image (final first), so the
    // card that opens is not a blank one.
    const bd = this._board;
    this._store.store.setUI({ highlightBoard: bd.id, highlightMode: frameImg(bd, 'final') ? 'final' : frameImg(bd, 'reference') ? 'reference' : null });
    this.close();
  }

  #unlink() {
    const id = this._board.id;
    this._store.store.reattachBoard(id, []);
    this.close();
    this.dispatchEvent(new CustomEvent('pandemonium-toast', { detail: { message: 'Storyboard unlinked from the script. Both frames are kept.' }, bubbles: true, composed: true }));
  }

  render() {
    if (!this._open) return html``;
    const bd = this._board;
    // A storyboard holds a final and a reference frame; show whichever has an
    // image (final first). A blank one shows its note in the empty frame.
    const img = frameImg(bd, 'final') || frameImg(bd, 'reference');
    const q = ((bd.anchor && bd.anchor.parts[0] && bd.anchor.parts[0].q) || '').slice(0, 80);
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <div class="img" title="Open in Boards" @click=${() => this.#openInBoards()}>${img ? html`<img alt="" src=${img}>` : (bd.note ? html`<div class="pnote">${bd.note}</div>` : '')}</div>
        <div class="meta"><span class="cap">${bd.caption || (img && bd.note) || q || 'Storyboard'}</span><button @click=${() => this.#unlink()}>Unlink</button></div>
      </div>
    `;
  }
}

customElements.define('pandemonium-highlight-popover', PandemoniumHighlightPopover);

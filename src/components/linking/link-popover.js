'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { clamp } from '../../utils/format.js';
import { boardRuns } from '../../data/project-model.js';
import { docTitle, hostOf } from '../../data/research-doc.js';
import { openPair } from '../../state/actions.js';
import '../boards/board-card.js';

// Everything attached to a script element, in one place. Click any linked
// words and this opens with ALL of it: the storyboard(s), the reference(s) and
// the comment(s) on that element, whichever of them the clicked words belong
// to, so a beat with all three shows all three.
//
// The storyboard is not a copy of the Storyboards panel's card, it IS that
// card (pandemonium-board-card), so it looks the same and has every control
// the same way: the Final/Reference marker, Preview from here, Edit, Unlink.
//
// Opened via `pandemonium-show-link-popover` with
// {boardIds, linkIds, commentIds, anchor}. It reads the records live by id, so
// an unlink from here is reflected at once, and it closes itself when nothing
// is left on the element.
export class PandemoniumLinkPopover extends LitElement {
  static properties = { _open: { state: true }, _ids: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    @keyframes pop-in{from{opacity:0;transform:translateY(-4px)}}
    .pop{
      animation:pop-in var(--dur-1) var(--ease-out);
      position:fixed;width:340px;max-width:calc(100vw - 16px);max-height:min(78vh,620px);overflow:auto;box-sizing:border-box;
      background:var(--panel);border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:12px;
      pointer-events:auto;font-family:var(--sans);box-shadow:0 4px 18px rgba(0,0,0,.18);
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    .sec{display:flex;flex-direction:column;gap:6px}
    .kh{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    .dot{width:7px;height:7px;border-radius:50%;flex:none}
    .dot.b{background:var(--board-strong)}
    .dot.br{background:var(--act)}
    .dot.r{background:var(--res)}
    .dot.c{background:var(--act)}
    .row{display:flex;flex-direction:column;gap:2px;min-width:0}
    .t{font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .s{font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .body{font-size:12px;line-height:1.45;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;
      display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
    .acts{display:flex;gap:6px;margin-top:2px}
    button.pill{
      height:24px;padding:0 11px;border:0;border-radius:20px;cursor:pointer;
      font-family:var(--sans);font-size:11px;font-weight:500;color:var(--ui);background:var(--bg);
      box-shadow:0 1px 1.25px rgba(0,0,0,.25);
    }
    button.pill:hover{background:var(--btn-hi)}
    button.pill.danger{color:var(--danger)}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
    this._ids = { boardIds: [], linkIds: [], commentIds: [] };
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
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) this.close(); };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  open({ boardIds = [], linkIds = [], commentIds = [], anchor }) {
    this._ids = { boardIds, linkIds, commentIds };
    this._anchor = anchor || null;
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

  // ---- what is on the element (read live, so an unlink shows at once) ----
  #records() {
    const p = this._store.project;
    const by = (list, ids) => ids.map((id) => list.find((x) => x.id === id)).filter(Boolean);
    const resolved = this._store.store.getFinalState().R.boards;
    return {
      boards: this._ids.boardIds.map((id) => resolved.find((o) => o.bd.id === id)).filter((o) => o && o.ok),
      runs: boardRuns(p.boards),
      links: by(p.links, this._ids.linkIds),
      comments: by(p.comments || [], this._ids.commentIds),
      research: p.research,
    };
  }

  // ---- actions ----
  #openRef(lk) {
    openPair(this._store.store, lk.id);
    this.close();
  }

  #unlinkRef(lk) {
    this._store.store.deleteLink(lk.id);
    dispatch(this, 'pandemonium-toast', { message: 'Reference unlinked.' });
  }

  #editComment(cm) {
    const rect = this._anchor ? this._anchor.getBoundingClientRect() : null;
    this.close();
    dispatch(this, 'pandemonium-show-comment', { commentId: cm.id, anchorRect: rect });
  }

  #deleteComment(cm) {
    this._store.store.deleteComment(cm.id);
  }

  // The card shows whichever frame has the picture (final first), like the
  // Storyboards panel does for a storyboard that has only a reference frame.
  #board(o, runs) {
    const bd = o.bd;
    const mode = !bd.img && bd.refImg ? 'reference' : 'final';
    return html`
      <div class="sec">
        <div class="kh"><i class="dot ${mode === 'reference' ? 'br' : 'b'}"></i>Storyboard</div>
        <pandemonium-board-card .resolved=${o} .mode=${mode} .run=${runs.get(bd.id)}></pandemonium-board-card>
      </div>
    `;
  }

  #ref(lk, research) {
    const d = research.find((x) => x.id === lk.researchId);
    return html`
      <div class="sec">
        <div class="kh"><i class="dot r"></i>Reference</div>
        <div class="row">
          <span class="t">${d ? docTitle(d) : 'A reference that no longer exists'}</span>
          ${d && d.url ? html`<span class="s">${hostOf(d.url)}</span>` : nothing}
        </div>
        <div class="acts">
          ${d ? html`<button class="pill" @click=${() => this.#openRef(lk)}>Open</button>` : nothing}
          <button class="pill" @click=${() => this.#unlinkRef(lk)}>Unlink</button>
        </div>
      </div>
    `;
  }

  #comment(cm) {
    return html`
      <div class="sec">
        <div class="kh"><i class="dot c"></i>Comment</div>
        <div class="body">${cm.body || 'An empty comment'}</div>
        <div class="acts">
          <button class="pill" @click=${() => this.#editComment(cm)}>Edit</button>
          <button class="pill danger" @click=${() => this.#deleteComment(cm)}>Delete</button>
        </div>
      </div>
    `;
  }

  render() {
    if (!this._open) return html``;
    const { boards, runs, links, comments, research } = this.#records();
    // Everything was unlinked from in here: nothing left to show.
    if (!boards.length && !links.length && !comments.length) {
      queueMicrotask(() => this.close());
      return html``;
    }
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px"
        @pandemonium-open-slideshow=${() => this.close()}>
        ${boards.map((b) => this.#board(b, runs))}
        ${links.map((l) => this.#ref(l, research))}
        ${comments.map((c) => this.#comment(c))}
      </div>
    `;
  }
}

customElements.define('pandemonium-link-popover', PandemoniumLinkPopover);

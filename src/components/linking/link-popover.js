'use strict';

import { LitElement, html, css, svg, nothing } from 'lit';

// The up-arrow on the comment note's round button, the same glyph as the comment card.
const DONE_ICON = svg`<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10V2.4M6 2.4 2.7 5.7M6 2.4 9.3 5.7" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { clamp } from '../../utils/format.js';
import { boardRuns } from '../../data/project-model.js';
import { openPair } from '../../state/actions.js';
import '../boards/board-card.js';
import '../research/research-card.js';

// Everything attached to a script element, in one place. Click any linked
// words and this opens with ALL of it: the storyboard(s), the reference(s) and
// the comment(s) on that element, whichever of them the clicked words belong
// to, so a beat with all three shows all three.
//
// Each item is drawn as ITS card, not a lookalike: the storyboard is the
// Storyboards panel's card (pandemonium-board-card, every control: the
// Final/Reference marker, Preview from here, Edit, Unlink); the reference is the
// References panel's card laid out sideways to suit a strip (Unlink on hover);
// the comment is the yellow sticky note, edited in place by clicking into it.
// No labels over them: a card says what it is.
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
      background:var(--panel);border-radius:16px;padding:8px;display:flex;flex-direction:column;gap:8px;
      pointer-events:auto;font-family:var(--sans);box-shadow:0 4px 18px rgba(0,0,0,.18);
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    .sec{position:relative;display:flex;flex-direction:column}

    /* The reference card, with an Unlink pill that appears on hover like the
       storyboard card's controls do (same white pill and lift). */
    .sec .pill{
      position:absolute;right:8px;bottom:8px;z-index:4;height:24px;padding:0 11px;border:0;border-radius:20px;cursor:pointer;
      font-family:var(--sans);font-size:11px;font-weight:500;color:#161719;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);
      opacity:0;pointer-events:none;transition:opacity var(--dur-1) var(--ease-out);
    }
    .sec:hover .pill,.sec .pill:focus-visible{opacity:1;pointer-events:auto}
    /* Comment: the same yellow pill as the one on the script's rail, inside the
       storyboard card at its top centre (the card's own controls hold the
       corners), shown on hover like they are. Only offered while the element
       has no comment yet. */
    .sec .pill.cmt{right:auto;bottom:auto;top:6px;left:50%;transform:translateX(-50%);background:var(--act);color:var(--act-ink)}
    .sec .pill.cmt:hover{background:var(--act-hi)}
    .sec .pill:hover{background:#f0f0f0}
    pandemonium-research-card{cursor:pointer}

    /* The comment: the same yellow-framed sticky note as the comment card
       (comment-popover.js), with its own white paper. Clicking the text is
       what edits it; nothing else has to be found. */
    .note{background:var(--act);border-radius:12px;padding:3px}
    .paper{background:rgba(255,255,255,.92);border-radius:9px;padding:10px;display:flex;flex-direction:column;gap:8px}
    .paper textarea{
      width:100%;min-height:44px;background:transparent;color:#161719;border:0;box-sizing:border-box;
      font-family:var(--sans);font-size:12px;line-height:1.5;resize:none;outline:none;padding:0;cursor:text;
    }
    .paper textarea::placeholder{color:rgba(0,0,0,.42)}
    .foot{display:flex;justify-content:space-between;align-items:center}
    .del{background:transparent;border:0;color:rgba(0,0,0,.5);font-size:11px;cursor:pointer;font-family:var(--sans);padding:2px 4px}
    .del:hover{color:var(--danger)}
    .done{
      width:22px;height:22px;border-radius:50%;background:#161719;border:0;cursor:pointer;margin-left:auto;
      display:inline-flex;align-items:center;justify-content:center;flex:none;
    }
    .done:hover{background:#000}
    .done svg{width:11px;height:11px;display:block}
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

  #deleteComment(cm) {
    this._store.store.deleteComment(cm.id);
  }

  // The card shows whichever frame has the picture (final first), like the
  // Storyboards panel does for a storyboard that has only a reference frame.
  #board(o, runs, canComment) {
    const bd = o.bd;
    const mode = !bd.img && bd.refImg ? 'reference' : 'final';
    return html`
      <div class="sec">
        <pandemonium-board-card .resolved=${o} .mode=${mode} .run=${runs.get(bd.id)}></pandemonium-board-card>
        ${canComment ? html`<button class="pill cmt" title="Add a comment to this passage" @click=${() => this.#addComment(o)}>Comment</button>` : nothing}
      </div>
    `;
  }

  // A comment on the same words the storyboard is on, added and shown right
  // here, with the cursor already in it.
  #addComment(o) {
    const c = this._store.store.addComment({ parts: (o.bd.anchor && o.bd.anchor.parts) || [] });
    this._ids = { ...this._ids, commentIds: [...this._ids.commentIds, c.id] };
    this._focusComment = c.id;
  }

  updated() {
    if (!this._focusComment) return;
    const ta = this.renderRoot.querySelector(`textarea[data-cid="${this._focusComment}"]`);
    if (ta) { this._focusComment = null; ta.focus(); }
    this.#position();
  }

  #ref(lk, research, links) {
    const d = research.find((x) => x.id === lk.researchId);
    if (!d) {
      return html`<div class="sec"><button class="pill" style="opacity:1;pointer-events:auto;position:static" @click=${() => this.#unlinkRef(lk)}>Unlink (the reference no longer exists)</button></div>`;
    }
    const n = links.filter((l) => l.researchId === d.id).length;
    return html`
      <div class="sec" @click=${() => this.#openRef(lk)}>
        <pandemonium-research-card wide .doc=${d} .linkCount=${n}></pandemonium-research-card>
        <button class="pill" title="Unlink this reference from the passage" @click=${(e) => { e.stopPropagation(); this.#unlinkRef(lk); }}>Unlink</button>
      </div>
    `;
  }

  #comment(cm) {
    return html`
      <div class="note">
        <div class="paper">
          <textarea data-cid=${cm.id} placeholder="Add a comment" .value=${cm.body || ''}
            @input=${(e) => this._store.store.updateCommentBody(cm.id, e.target.value)}></textarea>
          <div class="foot">
            <button class="del" @click=${() => this.#deleteComment(cm)}>Delete</button>
            <button class="done" title="Done" @click=${(e) => e.currentTarget.closest('.paper').querySelector('textarea').blur()}>${DONE_ICON}</button>
          </div>
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
        ${boards.map((b) => this.#board(b, runs, !comments.length))}
        ${links.map((l) => this.#ref(l, research, this._store.project.links))}
        ${comments.map((c) => this.#comment(c))}
      </div>
    `;
  }
}

customElements.define('pandemonium-link-popover', PandemoniumLinkPopover);

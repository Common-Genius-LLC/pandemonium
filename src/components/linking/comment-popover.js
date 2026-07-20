'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { clamp } from '../../utils/format.js';

// The inline comment box (notes.md points i and j). A comment has no research
// panel and no connector line: clicking its marker in the script opens this
// small editable box right where the marker is, and that's the whole comment
// UI. Opened via `pandemonium-show-comment` with {commentId, anchorRect}.
export class PandemoniumCommentPopover extends LitElement {
  static properties = { _open: { state: true }, _id: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:72;pointer-events:none}
    .pop{
      position:fixed;width:260px;background:var(--panel);border-radius:var(--r);padding:8px;
      display:flex;flex-direction:column;gap:6px;pointer-events:auto;font-family:var(--sans);
      box-shadow:0 2px 12px rgba(0,0,0,.18);
    }
    .lbl{font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    textarea{
      width:100%;min-height:70px;background:var(--bg);color:var(--ink);border:0;border-radius:var(--r);
      padding:7px 8px;font-family:var(--sans);font-size:12px;line-height:1.5;resize:vertical;outline:none;
    }
    textarea::placeholder{color:var(--mut)}
    .foot{display:flex;justify-content:space-between;align-items:center}
    button{height:22px;padding:0 9px;background:var(--bg);color:var(--ui);font-size:11px;font-weight:500;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
    button:hover{background:var(--ph)}
    button.del{color:var(--danger)}
    button.del:hover{background:var(--danger);color:#fff}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocDown = (e) => {
      if (!this._open) return;
      if (e.composedPath().includes(this)) return;
      this.#closeMaybeDiscard();
    };
    document.addEventListener('mousedown', this._onDocDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    super.disconnectedCallback();
  }

  open({ commentId, anchorRect }) {
    this._id = commentId;
    this._open = true;
    this.updateComplete.then(() => {
      this.#position(anchorRect);
      const t = this.renderRoot.querySelector('textarea');
      if (t) t.focus();
    });
  }

  close() { this._open = false; }

  // A never-written comment shouldn't linger as an empty invisible marker, so
  // closing an empty one deletes it (same as never having added it).
  #closeMaybeDiscard() {
    const c = this.#comment();
    if (c && !(c.body || '').trim()) this._store.store.deleteComment(c.id);
    this.close();
  }

  #comment() { return (this._store.project.comments || []).find((x) => x.id === this._id); }

  #position(rect) {
    const pop = this.renderRoot.querySelector('.pop');
    if (!pop || !rect) return;
    this._x = clamp(rect.left, 8, innerWidth - pop.offsetWidth - 8);
    this._y = clamp(rect.bottom + 8, 8, innerHeight - pop.offsetHeight - 8);
  }

  #body(e) { this._store.store.updateCommentBody(this._id, e.target.value); }
  #delete() { this._store.store.deleteComment(this._id); this.close(); }

  render() {
    if (!this._open) return html``;
    const c = this.#comment();
    if (!c) return html``;
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <span class="lbl">Comment</span>
        <textarea placeholder="Write a comment on this section..." .value=${c.body || ''} @input=${(e) => this.#body(e)}></textarea>
        <div class="foot">
          <button class="del" @click=${() => this.#delete()}>Delete</button>
          <button @click=${() => this.close()}>Done</button>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-comment-popover', PandemoniumCommentPopover);

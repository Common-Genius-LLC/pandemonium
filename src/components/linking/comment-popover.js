'use strict';

import { LitElement, html, css, svg } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { clamp } from '../../utils/format.js';

// The circular submit's up-arrow (a plain geometric glyph, drawn inline).
const SEND_ICON = svg`<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
  <path d="M6 10V2.4M6 2.4 2.7 5.7M6 2.4 9.3 5.7" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// The comment sticky note (Figma node 100-360): the yellow Comment pill expands
// into a yellow-framed white note with a circular submit. Opened via
// `pandemonium-show-comment` with {commentId, anchorRect}; it anchors at (and
// visually grows from) that rect. The white inner surface is a deliberate fixed
// "paper" like a sticky note rather than a themed fill -- the same kind of
// documented exception as the slideshow -- so a comment reads as a note in both
// light and dark. The frame is the action yellow (--act).
export class PandemoniumCommentPopover extends LitElement {
  static properties = { _open: { state: true }, _id: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:72;pointer-events:none}
    .pop{
      position:fixed;width:240px;background:var(--act);border-radius:12px;padding:3px;
      pointer-events:auto;font-family:var(--sans);box-shadow:0 4px 16px rgba(0,0,0,.22);
      transform-origin:top right;animation:pop-in .12s ease-out;
    }
    @keyframes pop-in{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
    .inner{background:rgba(255,255,255,.92);border-radius:9px;padding:10px;display:flex;flex-direction:column;gap:8px}
    textarea{
      width:100%;min-height:56px;background:transparent;color:#161719;border:0;
      font-family:var(--sans);font-size:12px;line-height:1.5;resize:vertical;outline:none;padding:0;
    }
    textarea::placeholder{color:rgba(0,0,0,.42)}
    .foot{display:flex;justify-content:space-between;align-items:center}
    .del{background:transparent;border:0;color:rgba(0,0,0,.5);font-size:11px;cursor:pointer;font-family:var(--sans);padding:2px 4px}
    .del:hover{color:var(--danger)}
    .send{
      width:22px;height:22px;border-radius:50%;background:#161719;border:0;cursor:pointer;margin-left:auto;
      display:inline-flex;align-items:center;justify-content:center;flex:none;
    }
    .send:hover{background:#000}
    .send svg{width:11px;height:11px;display:block}
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
    // Align the note's right edge to the anchor's right and grow down from it,
    // so it reads as expanding out of the Comment pill (transform-origin top
    // right). Falls back to the viewport edge when it would overflow.
    this._x = clamp(rect.right - pop.offsetWidth, 8, innerWidth - pop.offsetWidth - 8);
    this._y = clamp(rect.bottom + 6, 8, innerHeight - pop.offsetHeight - 8);
  }

  #body(e) { this._store.store.updateCommentBody(this._id, e.target.value); }
  #delete() { this._store.store.deleteComment(this._id); this.close(); }

  render() {
    if (!this._open) return html``;
    const c = this.#comment();
    if (!c) return html``;
    const hasBody = !!(c.body || '').trim();
    return html`
      <div class="pop" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <div class="inner">
          <textarea placeholder="Add a comment" .value=${c.body || ''} @input=${(e) => this.#body(e)}></textarea>
          <div class="foot">
            ${hasBody ? html`<button class="del" @click=${() => this.#delete()}>Delete</button>` : html`<span></span>`}
            <button class="send" title="Save comment" @click=${() => this.#closeMaybeDiscard()}>${SEND_ICON}</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-comment-popover', PandemoniumCommentPopover);

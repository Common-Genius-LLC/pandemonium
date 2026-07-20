'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { openSourceDialog } from '../research/source-dialog.js';
import { clamp } from '../../utils/format.js';

// One instance at app-root. Opened via `pandemonium-show-selection-toolbar`
// with {kind: 'script'|'research'|'non-final', parts, anchorRect, scriptId?}.
// Owns every resulting action (attach a board, create/link a source, start
// a script<->research pairing, or -- the bug-2 fix -- promote a non-final
// draft to final right from the selection) so script-panel and
// research-reader only ever have to report what got selected, not decide
// what happens next.
export class PandemoniumSelectionToolbar extends LitElement {
  static properties = { _open: { state: true }, _kind: { state: true }, _x: { state: true }, _y: { state: true } };

  static styles = css`
    :host{position:fixed;inset:0;z-index:70;pointer-events:none}
    .bar{
      position:fixed;background:var(--ui);color:#fff;border-radius:var(--r);display:flex;padding:3px;gap:2px;
      pointer-events:auto;font-family:var(--sans);
    }
    button{
      color:#fff;font-size:11px;font-weight:500;padding:4px 9px;white-space:nowrap;text-align:left;
      background:none;border:0;border-radius:2px;cursor:pointer;font-family:var(--sans);
    }
    button:hover{background:rgba(255,255,255,.16)}
    button.b::before,button.r::before,button.n::before{content:"";width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
    button.b::before{background:var(--board)}
    button.r::before{background:var(--res)}
    button.n::before{background:var(--act)}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
    this._parts = null;
    this._scriptId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocDown = (e) => {
      if (!this._open) return;
      if (e.composedPath().includes(this)) return;
      this.close();
    };
    document.addEventListener('mousedown', this._onDocDown, true);
    this._onScroll = () => this.close();
    ['scroll'].forEach((ev) => document.addEventListener(ev, this._onScroll, true));
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    document.removeEventListener('scroll', this._onScroll, true);
    super.disconnectedCallback();
  }

  open({ kind, parts, anchorRect, scriptId }) {
    this._kind = kind;
    this._parts = parts;
    this._scriptId = scriptId || null;
    this._anchorRect = anchorRect || null;
    this._open = true;
    this.updateComplete.then(() => this.#position(anchorRect));
  }

  close() {
    this._open = false;
  }

  #position(rect) {
    const bar = this.renderRoot.querySelector('.bar');
    if (!bar || !rect) return;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    this._x = clamp(rect.left + rect.width / 2 - bw / 2, 8, innerWidth - bw - 8);
    this._y = clamp(rect.bottom + 8, 8, innerHeight - bh - 8);
  }

  #act(act) {
    const store = this._store.store;
    const parts = this._parts;
    this.close();
    if (act === 'make-final') {
      store.makeFinal(this._scriptId);
      dispatch(this, 'pandemonium-toast', { message: 'This is now the final draft. Select the passage again to add a board or source.' });
      return;
    }
    if (act === 'board') {
      const input = this.renderRoot.getElementById('fileImg');
      input.value = '';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const img = await readFileAsDataURL(file);
        store.addBoard({ parts, img, caption: '' });
        dispatch(this, 'pandemonium-toast', { message: 'Board added.' });
      };
      input.click();
      return;
    }
    if (act === 'comment') {
      const c = store.addComment({ parts });
      dispatch(this, 'pandemonium-show-comment', { commentId: c.id, anchorRect: this._anchorRect });
      return;
    }
    if (act === 'source') {
      if (!store.project.research.length) { openSourceDialog(this, store, parts, 'link'); return; }
      store.setUI({
        linking: { from: 'script', parts },
        view: store.ui.view === 'single' ? 'split' : store.ui.view,
        split: 'research',
        openDoc: null,
      });
      return;
    }
    if (act === 'tolink') {
      store.setUI({ linking: { from: 'research', docId: store.ui.openDoc, rParts: parts } });
    }
  }

  render() {
    if (!this._open) return html``;
    let buttons;
    if (this._kind === 'non-final') {
      buttons = html`<button @click=${() => this.#act('make-final')}>Make this the final draft to add boards &amp; research</button>`;
    } else if (this._kind === 'research') {
      buttons = html`<button class="r" @click=${() => this.#act('tolink')}>Link to script</button>`;
    } else {
      buttons = html`
        <button class="b" @click=${() => this.#act('board')}>Board</button>
        <button class="r" @click=${() => this.#act('source')}>Source</button>
        <button class="n" @click=${() => this.#act('comment')}>Comment</button>
      `;
    }
    return html`
      <div class="bar" style="left:${this._x || 0}px;top:${this._y || 0}px">${buttons}</div>
      <input type="file" id="fileImg" accept="image/*" style="display:none">
    `;
  }
}

customElements.define('pandemonium-selection-toolbar', PandemoniumSelectionToolbar);

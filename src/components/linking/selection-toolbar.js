'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL, isBoardMediaFile, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import { linkToItems } from './link-actions.js';
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
      position:fixed;background:var(--overlay);color:var(--overlay-ink);border-radius:var(--r);display:flex;padding:3px;gap:2px;
      pointer-events:auto;font-family:var(--sans);
    }
    button{
      color:var(--overlay-ink);font-size:11px;font-weight:500;padding:4px 9px;white-space:nowrap;text-align:left;
      background:none;border:0;border-radius:2px;cursor:pointer;font-family:var(--sans);
    }
    button:hover{background:rgba(255,255,255,.16)}
    button.b::before,button.r::before,button.n::before{content:"";width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
    button.b::before{background:var(--board)}
    button.r::before{background:var(--res)}
    button.n::before{background:var(--act)}

    /* The script-selection affordance mirrors the in-editor row rail
       (cm-sections / cm-theme): the same "link to" and "Comment" pills, so a
       hand-dragged selection and a whole row offer the identical thing. */
    .pills{position:fixed;display:flex;gap:6px;pointer-events:auto;font-family:var(--sans)}
    .pills button{
      font-size:12px;font-weight:500;line-height:1;padding:6px 12px;min-height:24px;border:0;border-radius:20px;
      cursor:pointer;white-space:nowrap;text-align:center;
    }
    .pills button.linkto{background:var(--overlay);color:var(--overlay-ink)}
    .pills button.linkto:hover{background:var(--ui)}
    .pills button.comment{background:var(--act);color:var(--act-ink)}
    .pills button.comment:hover{background:var(--act-hi)}
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
    const bar = this.renderRoot.querySelector('.bar, .pills');
    if (!bar || !rect) return;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    this._x = clamp(rect.left + rect.width / 2 - bw / 2, 8, innerWidth - bw - 8);
    this._y = clamp(rect.bottom + 8, 8, innerHeight - bh - 8);
  }

  #act(act) {
    const store = this._store.store;
    this.close();
    if (act === 'make-final') {
      store.makeFinal(this._scriptId);
      dispatch(this, 'pandemonium-toast', { message: 'This is now the final draft. Select the passage again to add a board or source.' });
      return;
    }
    if (act === 'tolink') {
      // The script has to be on screen to be selected in, the mirror of
      // #sourceFromParts revealing Research for the other direction.
      store.revealContent('script');
      store.setUI({ linking: { from: 'research', docId: store.ui.openDoc, rParts: this._parts } });
    }
  }

  // The script-selection "link to" menu, identical to the in-editor row rail's
  // (see link-actions.js). The parts are captured now because picking a target
  // is a click outside this toolbar, which closes it first.
  #openLinkMenu(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const parts = this._parts;
    const items = linkToItems({
      onStoryboard: () => this.#boardFromParts(parts),
      onBlankStoryboard: () => this.#blankFromParts(parts),
      onResearch: () => this.#sourceFromParts(parts),
      onSound: () => dispatch(this, 'pandemonium-toast', { message: 'Sound linking is coming soon.' }),
    });
    dispatch(this, 'pandemonium-open-menu', { x: rect.left, y: rect.bottom + 4, items, variant: 'pills' });
  }

  // A transient file input rather than one in the template: the menu that
  // triggers this closes the toolbar first, so an input rendered by this
  // component would already be gone by the time the picker returns. Several at
  // once, because several boards can attach to one passage; they keep pick order.
  #boardFromParts(parts) {
    const store = this._store.store;
    store.revealContent('boards'); // open the boards panel if it is closed
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = BOARD_MEDIA_ACCEPT;
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])].filter(isBoardMediaFile);
      if (!files.length) return;
      // Final frames (the deliberate "this is the frame" action); the first
      // fills an empty final frame already on this passage, see placeFrame.
      for (const file of files) store.placeFrame({ parts, img: await readFileAsDataURL(file), caption: '', mode: 'final' });
      dispatch(this, 'pandemonium-toast', {
        message: files.length === 1 ? 'Storyboard added.' : files.length + ' storyboards added to this passage.',
      });
    };
    input.click();
  }

  // A storyboard with no image in either frame, on the selected passage.
  #blankFromParts(parts) {
    const store = this._store.store;
    store.revealContent('boards');
    const board = store.addBlankBoard({ parts });
    store.setUI({ highlightBoard: board.id, highlightMode: 'final' });
    dispatch(this, 'pandemonium-toast', { message: 'Blank storyboard added. Give it a note, or drop an image on either frame.' });
  }

  // One flow whether or not a source exists yet: reveal the panel and arm the
  // pick. Anything created in the panel while it is armed links itself to this
  // passage (see #consumePendingLink in research-panel.js), so there is no
  // "you have nothing yet" branch and no modal form.
  #sourceFromParts(parts) {
    const store = this._store.store;
    store.revealContent('research'); // the source has to be pickable to be picked
    store.setUI({ linking: { from: 'script', parts }, openDoc: null });
  }

  #commentFromParts(parts) {
    const store = this._store.store;
    const anchorRect = this._anchorRect;
    this.close();
    const c = store.addComment({ parts });
    dispatch(this, 'pandemonium-show-comment', { commentId: c.id, anchorRect });
  }

  render() {
    if (!this._open) return html``;
    if (this._kind === 'non-final') {
      return html`<div class="bar" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <button @click=${() => this.#act('make-final')}>Make this the final draft to add boards &amp; research</button>
      </div>`;
    }
    if (this._kind === 'research') {
      return html`<div class="bar" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <button class="r" @click=${() => this.#act('tolink')}>Link to script</button>
      </div>`;
    }
    // Script selection: the same two pills the row hover offers.
    return html`
      <div class="pills" style="left:${this._x || 0}px;top:${this._y || 0}px">
        <button class="linkto" @click=${(e) => this.#openLinkMenu(e)}>link to</button>
        <button class="comment" @click=${() => this.#commentFromParts(this._parts)}>Comment</button>
      </div>
    `;
  }
}

customElements.define('pandemonium-selection-toolbar', PandemoniumSelectionToolbar);

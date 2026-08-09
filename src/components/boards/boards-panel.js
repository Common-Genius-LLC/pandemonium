'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { boardOrder } from '../../state/selectors.js';
import { boardRuns } from '../../data/project-model.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL, isBoardMediaFile, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './board-card.js';

// "Add Image" opens the file picker immediately -- no
// prerequisite step. It used to require selecting a script passage first
// (arming a "pick a passage" mode and waiting for a selection elsewhere),
// which was the actual source of "I have no idea how to upload a
// thumbnail": the button didn't visibly do anything until you went and
// found more UI in a different panel. Now it just uploads, and the
// resulting board is created unattached (anchor.parts: []) -- the exact
// same state a board ends up in when its passage can no longer be found,
// so it renders as "unlinked" with a "Reattach" button already built for
// this, and you attach it to a passage whenever you like, from a normal
// text selection or not at all.
// Element types shown as text in the rendered-script view (page/note are not
// script lines a reader scans past frames).
const DOC_TYPES = new Set(['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'centered', 'lyric', 'synopsis', 'section']);

export class PandemoniumBoardsPanel extends LitElement {
  static properties = { leafId: {}, _mode: { state: true }, _showScript: { state: true }, _dragging: { state: true } };

  static styles = [panelStyles, css`
    .pbody.over{outline:2px solid var(--res);outline-offset:-2px}
    /* Final / Reference switch: the beat's chosen frames vs inspiration for it.
       Reference boards never count as boarded (see coverage). */
    .modes{display:flex;gap:2px;align-self:center;margin-right:6px}
    .modes button{height:22px;padding:0 10px;font-size:11px;font-weight:500;color:var(--mut);
      background:var(--panel);border:0;border-radius:20px;cursor:pointer;font-family:var(--sans)}
    .modes button.on{background:var(--overlay);color:var(--overlay-ink)}
    #boardsList{display:flex;flex-direction:column;gap:6px;padding:10px 10px 24px}
    /* Rendered-script view (Figma 82-34): the final draft's elements shown as
       formatted lines with the frames embedded at their linked positions. The
       frames stay raw images (board-card); this is the script context around
       them. */
    .doc{display:flex;flex-direction:column;gap:5px;padding:10px 10px 24px}
    /* Script font matches the editor (Courier Prime Sans, --script). */
    .el{font-family:var(--script);font-size:16px;line-height:1.5;color:var(--ink);white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
    .el.scene{font-weight:700;text-transform:uppercase;margin-top:12px}
    .el.section{font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-top:12px}
    .el.character{font-weight:700;text-transform:uppercase;text-align:center;margin-top:6px}
    .el.dialogue,.el.paren{text-align:center;max-width:78%;margin:0 auto}
    .el.transition{text-align:right;text-transform:uppercase}
    .el.centered{text-align:center}
    .el.synopsis,.el.lyric{font-style:italic;color:var(--mut)}
    .frame-wrap{margin:6px 0}
    .unlinked-h{margin-top:16px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    /* A section boarded in the other mode but not this one shows a blank frame
       here; dropping an image fills it as a board of the current mode. */
    .placeholder{aspect-ratio:16/9;background:var(--ph);opacity:.5;display:flex;align-items:center;justify-content:center;
      text-align:center;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);padding:0 10px}
    .placeholder.over{opacity:.85;outline:2px dashed var(--res);outline-offset:-2px}
    /* Figma "Frame 4" (node 19:330): the illustration over the pane's own
       pink, with the drop invitation beneath it, centered in the empty pane. */
    .noboards{
      height:100%;min-height:200px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    }
    .noboards img{width:440px;max-width:78%;height:auto;display:block;pointer-events:none}
    .noboards p{
      width:250px;max-width:70%;margin:0;text-align:center;
      font-size:14px;line-height:18px;color:var(--mut);
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._mode = 'final';
    this._showScript = true;
  }

  #title() {
    return html`<pd-panel-picker current="boards" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  #addBoard() {
    const input = this.renderRoot.getElementById('fileImg');
    input.value = '';
    input.click();
  }

  #startSlideshow() {
    // Start the show in whichever storyboard the panel is viewing.
    dispatch(this, 'pandemonium-open-slideshow', { mode: this._mode });
  }

  // Settings: where image drops from the editor/timeline land.
  #openSettings(e) {
    const store = this._store.store;
    const toRef = store.project.dropToReference !== false;
    dispatch(this, 'pandemonium-open-menu', {
      anchor: e.currentTarget,
      items: [
        { label: 'Drops from script/timeline → Reference', selected: toRef, fn: () => store.setDropToReference(true) },
        { label: 'Drops from script/timeline → Final', selected: !toRef, fn: () => store.setDropToReference(false) },
      ],
    });
  }

  async #onFilePicked(e) {
    await this.#addImages(e.target.files || []);
  }

  // The empty pane invites a drop, so the pane has to accept one. Same
  // unattached board a picked file produces, one per image dropped.
  async #addImages(files) {
    const images = [...files].filter(isBoardMediaFile);
    if (!images.length) return;
    const ref = this._mode === 'reference';
    for (const file of images) {
      const img = await readFileAsDataURL(file);
      this._store.store.addBoard({ parts: [], img, caption: '', ref });
    }
    dispatch(this, 'pandemonium-toast', {
      message: images.length === 1
        ? 'Board added. Select a script passage anytime to attach it.'
        : images.length + ' boards added. Select a script passage anytime to attach them.',
    });
  }

  #onDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('over');
    if (!this._dragging) this._dragging = true;
  }

  #onDragLeave(e) {
    // Ignore leaves into a child (dragleave bubbles); only clear on real exit.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    e.currentTarget.classList.remove('over');
    this._dragging = false;
  }

  async #onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('over');
    this._dragging = false;
    await this.#addImages(e.dataTransfer.files || []);
  }

  updated() {
    const ui = this._store.ui;
    if (!ui || !ui.highlightBoard) return;
    const id = ui.highlightBoard;
    this._store.store.setUI({ highlightBoard: null });
    requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector(`pandemonium-board-card[data-board-id="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.style.outline = '2px solid var(--board)';
      setTimeout(() => { card.style.outline = ''; }, 1200);
    });
  }

  #frameCard(o, runs, state) {
    // A counterpart is the same section's frame in the other mode, if it has an
    // image -- that is when the marker offers a swap rather than a move.
    let counterpart = null;
    if (o.ok && state) {
      const c = state.R.boards.find((x) => x.ok && x.bd.id !== o.bd.id && x.firstBi === o.firstBi && !!x.bd.ref !== !!o.bd.ref && x.bd.img);
      counterpart = c ? c.bd.id : null;
    }
    return html`<div class="frame-wrap"><pandemonium-board-card .resolved=${o} .run=${runs.get(o.bd.id)} .counterpartId=${counterpart}></pandemonium-board-card></div>`;
  }

  #byBi(arr) {
    const m = new Map();
    for (const o of arr) { if (!o.ok) continue; if (!m.has(o.firstBi)) m.set(o.firstBi, []); m.get(o.firstBi).push(o); }
    return m;
  }

  // Sections boarded in the OTHER mode but not this one, keyed by the block the
  // board anchors to, carrying that board's anchor parts so a placeholder frame
  // can create the missing counterpart (final beside a reference, or vice versa).
  #otherModeAnchors(state) {
    const reference = this._mode === 'reference';
    const m = new Map();
    for (const o of state.R.boards) {
      if (!o.ok || !!o.bd.ref === reference) continue;
      if (!m.has(o.firstBi)) m.set(o.firstBi, o.bd.anchor.parts);
    }
    return m;
  }

  // The rendered-script view: walk the final draft's blocks, printing each
  // element as a formatted line and dropping this mode's frame in right after
  // the element it is anchored to. Where the other mode boarded a section this
  // one has not, a blank placeholder frame stands in. Boards that no longer
  // resolve are collected under an "Unlinked frames" heading at the foot.
  #scriptView(state, arr, runs) {
    const byBi = this.#byBi(arr);
    const other = this.#otherModeAnchors(state);
    const rows = [];
    for (const b of state.fparsed.blocks) {
      if (b.line != null && b.plain && b.plain.trim() && DOC_TYPES.has(b.type)) {
        rows.push(html`<div class="el ${b.type}">${b.plain}</div>`);
      }
      if (byBi.has(b.i)) for (const o of byBi.get(b.i)) rows.push(this.#frameCard(o, runs, state));
      else if (other.has(b.i)) rows.push(this.#placeholder(other.get(b.i)));
    }
    return html`<div class="doc">${rows}${this.#unlinked(arr, runs, state)}</div>`;
  }

  // Frames only (script hidden): the same frames and placeholders in script
  // order, without the element text between them.
  #framesOnly(state, arr, runs) {
    const byBi = this.#byBi(arr);
    const other = this.#otherModeAnchors(state);
    const rows = [];
    for (const b of state.fparsed.blocks) {
      if (byBi.has(b.i)) for (const o of byBi.get(b.i)) rows.push(this.#frameCard(o, runs, state));
      else if (other.has(b.i)) rows.push(this.#placeholder(other.get(b.i)));
    }
    return html`<div id="boardsList">${rows}${this.#unlinked(arr, runs, state)}</div>`;
  }

  #unlinked(arr, runs, state) {
    const unlinked = arr.filter((o) => !o.ok);
    if (!unlinked.length) return '';
    return html`<div class="unlinked-h">Unlinked frames</div>${unlinked.map((o) => this.#frameCard(o, runs, state))}`;
  }

  // A blank frame for a section this mode has not boarded yet; drop or click
  // fills it as a board of the current mode at the other mode's anchor.
  #placeholder(parts) {
    const label = this._mode === 'reference' ? 'Add reference frame' : 'Add final frame';
    return html`<div class="frame-wrap"><div class="placeholder"
      title="Drop or click to add this frame"
      @click=${() => this.#addToAnchor(parts)}
      @dragover=${(e) => this.#phOver(e)}
      @dragleave=${(e) => this.#phLeave(e)}
      @drop=${(e) => this.#phDrop(e, parts)}>${label}</div></div>`;
  }

  #phOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('over');
  }
  #phLeave(e) { e.currentTarget.classList.remove('over'); }
  async #phDrop(e, parts) {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.classList.remove('over');
    const file = [...(e.dataTransfer.files || [])].find(isBoardMediaFile);
    if (file) await this.#fillAnchor(parts, file);
  }
  #addToAnchor(parts) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = BOARD_MEDIA_ACCEPT;
    input.onchange = () => { const f = input.files && input.files[0]; if (f) this.#fillAnchor(parts, f); };
    input.click();
  }
  async #fillAnchor(parts, file) {
    const img = await readFileAsDataURL(file);
    this._store.store.addBoard({ parts, img, caption: '', ref: this._mode === 'reference' });
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const reference = this._mode === 'reference';
    const arr = state.R.boards.filter((o) => !!o.bd.ref === reference).sort(boardOrder);
    const runs = boardRuns(project.boards);
    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          ${this.#title()}
          <div class="modes">
            <button class=${this._mode === 'final' ? 'on' : ''} @click=${() => { this._mode = 'final'; }}>Final</button>
            <button class=${this._mode === 'reference' ? 'on' : ''} @click=${() => { this._mode = 'reference'; }}>Reference</button>
          </div>
          <div class="tools">
            ${this._dragging
              ? html`<pd-button variant="pink">Drop here to add as new board</pd-button>`
              : html`
                <pd-button title=${this._showScript ? 'Hide the script text between frames' : 'Show the script text between frames'} @click=${() => { this._showScript = !this._showScript; }}>${this._showScript ? 'Hide script' : 'Show script'}</pd-button>
                <pd-button variant="pink" title="Play the linked storyboards full-screen" @click=${() => this.#startSlideshow()}>Start Show</pd-button>
                <pd-button title="Add images or video as storyboard frames" @click=${() => this.#addBoard()}>Add Media</pd-button>
                <pd-button title="Storyboard settings" @click=${(e) => this.#openSettings(e)}>⚙</pd-button>`}
          </div>
        </div>
        <div class="pbody"
          @dragover=${(e) => this.#onDragOver(e)}
          @dragleave=${(e) => this.#onDragLeave(e)}
          @drop=${(e) => this.#onDrop(e)}>
          ${arr.length || this.#otherModeAnchors(state).size
            ? (this._showScript ? this.#scriptView(state, arr, runs) : this.#framesOnly(state, arr, runs))
            : html`<div class="noboards">
                <img src="/boards-empty.png" alt="">
                <p>drop ${reference ? 'reference images' : 'images'} here to use as storyboard panels</p>
              </div>`}
        </div>
      </div>
      <input type="file" id="fileImg" accept=${BOARD_MEDIA_ACCEPT} multiple style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }
}

customElements.define('pandemonium-boards-panel', PandemoniumBoardsPanel);

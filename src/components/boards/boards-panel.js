'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { linkedBoards, describeSlideshowGap, boardLinkKinds } from '../../state/selectors.js';
import { boardRuns } from '../../data/project-model.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL, isBoardMediaFile, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './board-card.js';
import '../ui/segmented.js';
import { crossfade } from '../../utils/motion.js';

const MODE_OPTIONS = [{ value: 'final', label: 'Final' }, { value: 'reference', label: 'Reference' }];

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
    /* Positions .modes against the whole pane, not .pbody: .pbody scrolls
       (a long boards list), and the switch has to stay put while it does,
       not travel with the content. */
    .shell{position:relative}
    .pbody.over{outline:2px solid var(--res);outline-offset:-2px}
    /* Final / Reference switch: the beat's chosen frames vs inspiration for
       it. Reference boards never count as boarded (see coverage). Floats
       bottom-center over the frames, like the same switch in the slideshow
       (.sbswitch there), rather than crowding the toolbar. */
    .modes{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:5;
      border-radius:20px;box-shadow:0 1px 4px rgba(0,0,0,.18)}
    #boardsList{display:flex;flex-direction:column;gap:6px;padding:10px 10px 24px}
    /* Rendered-script view (Figma 82-34): the final draft's elements shown as
       formatted lines with the frames embedded at their linked positions. The
       frames stay raw images (board-card); this is the script context around
       them. */
    .doc{display:flex;flex-direction:column;gap:5px;padding:10px 10px 24px}
    /* Script font matches the editor (Courier Prime Sans, --script). */
    .el{position:relative;font-family:var(--script);font-size:16px;line-height:1.5;color:var(--ink);white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
    /* Link bars: green beside a line a final board lands on, yellow for a
       reference-only one. */
    .el.lf::before,.el.lr::before{content:"";position:absolute;left:-8px;top:2px;bottom:2px;width:3px;border-radius:2px}
    .el.lf::before{background:var(--board-strong)}
    .el.lr::before{background:var(--act)}
    .el.scene{font-weight:700;text-transform:uppercase;margin-top:12px}
    .el.section{font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-top:12px}
    .el.character{font-weight:700;text-transform:uppercase;text-align:center;margin-top:6px}
    .el.dialogue{text-align:center;max-width:78%;margin:0 auto}
    /* Craft/technical elements read a step muted, same tiering as the editor
       (cm-theme.js): they're present but shouldn't compete with story content. */
    .el.paren{text-align:center;max-width:78%;margin:0 auto;color:var(--ui)}
    .el.transition{text-align:right;text-transform:uppercase;color:var(--ui)}
    .el.lyric{font-style:italic;color:var(--ui)}
    .el.centered{text-align:center}
    .el.synopsis{font-style:italic;color:var(--mut)}
    .frame-wrap{margin:6px 0}
    .unlinked-h{margin-top:16px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
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
    // Frames only by default: the script text between them is a toggle away,
    // not the first thing a storyboard pane shows.
    this._showScript = false;
  }

  #title() {
    return html`<pd-panel-picker current="boards" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  #addBoard() {
    const input = this.renderRoot.getElementById('fileImg');
    input.value = '';
    input.click();
  }

  // A storyboard with no image in either frame. Unlinked, so it lands under
  // "Unlinked frames" ready to be attached to a passage; to make one on a
  // passage directly, use "Blank storyboard" in the script's link menu.
  #addBlank() {
    const board = this._store.store.addBlankBoard({ parts: [] });
    this._store.store.setUI({ highlightBoard: board.id });
    dispatch(this, 'pandemonium-toast', { message: 'Blank storyboard added. Link it to a passage, add a note, or drop an image on either frame.' });
  }

  #startSlideshow() {
    // Start the show in whichever storyboard the panel is viewing.
    const state = this._store.store.getFinalState();
    const gap = describeSlideshowGap(state.fparsed, state.R.boards, this._mode, 'preview the show');
    if (gap) { dispatch(this, 'pandemonium-toast', { message: gap }); return; }
    dispatch(this, 'pandemonium-open-slideshow', { mode: this._mode });
  }

  async #onFilePicked(e) {
    await this.#addImages(e.target.files || []);
  }

  // The empty pane invites a drop, so the pane has to accept one. Same
  // unattached storyboard a picked file produces, one per image dropped, with
  // the image in whichever frame this panel is showing.
  async #addImages(files) {
    const images = [...files].filter(isBoardMediaFile);
    if (!images.length) return;
    for (const file of images) {
      const img = await readFileAsDataURL(file);
      this._store.store.addBoard({ parts: [], img, caption: '', mode: this._mode });
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

  // A storyboard just added or jumped to from elsewhere (a drop on the script,
  // a search result, a highlight popover) scrolls into view and flashes pink.
  // Every storyboard is in both views, so the card is always there; what the
  // highlight can add is which view to show it in (`highlightMode`): the frame
  // that just got its image, so "look, here's what just happened" is visible.
  updated(changed) {
    if (changed.has('_mode') && changed.get('_mode') !== undefined) {
      crossfade(this.renderRoot.querySelector('#boardsList, .doc, .noboards'));
    }
    const ui = this._store.ui;
    if (!ui || !ui.highlightBoard) return;
    const id = ui.highlightBoard;
    const mode = ui.highlightMode;
    this._store.store.setUI({ highlightBoard: null, highlightMode: null });
    if (mode) this._mode = mode;
    requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector(`pandemonium-board-card[data-board-id="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.style.outline = '2px solid var(--res)';
      setTimeout(() => { card.style.outline = ''; }, 2000);
    });
  }

  // Every storyboard has a card in both views: this view's frame, filled or
  // blank. A blank one is a click-or-drop card of its own (see board-card.js).
  #frameCard(o, runs) {
    return html`<div class="frame-wrap"><pandemonium-board-card .resolved=${o} .mode=${this._mode} .run=${runs.get(o.bd.id)}></pandemonium-board-card></div>`;
  }

  #byBi(linked) {
    const m = new Map();
    for (const o of linked) { if (!m.has(o.firstBi)) m.set(o.firstBi, []); m.get(o.firstBi).push(o); }
    return m;
  }

  // The rendered-script view: walk the final draft's blocks, printing each
  // element as a formatted line and dropping this view's frame of each
  // storyboard in right after the element it is anchored to. Storyboards that
  // no longer resolve are collected under an "Unlinked frames" heading at the
  // foot.
  #scriptView(state, all, linked, runs) {
    const byBi = this.#byBi(linked);
    const kinds = boardLinkKinds(state.R.boards);
    const rows = [];
    for (const b of state.fparsed.blocks) {
      if (b.line != null && b.plain && b.plain.trim() && DOC_TYPES.has(b.type)) {
        // A bar beside a linked line: green if a final board lands here,
        // yellow if only a reference one does (the same split as the editor
        // highlight, timeline and minimap).
        const k = kinds.get(b.i);
        const bar = k ? (k.final ? 'lf' : 'lr') : '';
        rows.push(html`<div class="el ${b.type} ${bar}">${b.plain}</div>`);
      }
      if (byBi.has(b.i)) for (const o of byBi.get(b.i)) rows.push(this.#frameCard(o, runs));
    }
    return html`<div class="doc">${rows}${this.#unlinked(all, runs)}</div>`;
  }

  // Frames only (script hidden): the same frames in script order, without the
  // element text between them.
  #framesOnly(state, all, linked, runs) {
    const byBi = this.#byBi(linked);
    const rows = [];
    for (const b of state.fparsed.blocks) {
      if (byBi.has(b.i)) for (const o of byBi.get(b.i)) rows.push(this.#frameCard(o, runs));
    }
    return html`<div id="boardsList">${rows}${this.#unlinked(all, runs)}</div>`;
  }

  #unlinked(all, runs) {
    const unlinked = all.filter((o) => !o.ok);
    if (!unlinked.length) return '';
    return html`<div class="unlinked-h">Unlinked frames</div>${unlinked.map((o) => this.#frameCard(o, runs))}`;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const reference = this._mode === 'reference';
    const all = state.R.boards;
    const linked = linkedBoards(all);
    const runs = boardRuns(project.boards);
    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          ${this.#title()}
          <div class="tools">
            ${this._dragging
              ? html`<pd-button variant="pink">Drop here to add as new board</pd-button>`
              : html`
                <pd-button icon variant=${this._showScript ? 'dark' : 'default'}
                  title=${this._showScript ? 'Hide the script text between frames' : 'Show the script text between frames'}
                  @click=${() => { this._showScript = !this._showScript; }}
                ><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-320h320v-80H240v80Zm400 0h80v-80h-80v80ZM240-480h80v-80h-80v80Zm160 0h320v-80H400v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z"/></svg></pd-button>
                <pd-button icon title="Add images or video as storyboard frames" @click=${() => this.#addBoard()}
                  ><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M160-240v-480 480Zm80-80v-200h360v200H240Zm-80 160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v240h-80v-240H160v480h360v80H160Zm500-320v-100H360v-60h360v160h-60Zm60 400v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/></svg></pd-button>
                <pd-button icon title="Add a blank storyboard: no image yet, but it can carry a note" @click=${() => this.#addBlank()}
                  ><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-280h80v-160h160v-80H520v-160h-80v160H280v80h160v160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg></pd-button>
                <pd-button variant="pink" title="Play the linked storyboards full-screen" @click=${() => this.#startSlideshow()}>Preview</pd-button>`}
          </div>
        </div>
        <div class="pbody" data-clarity-mask="true"
          @dragover=${(e) => this.#onDragOver(e)}
          @dragleave=${(e) => this.#onDragLeave(e)}
          @drop=${(e) => this.#onDrop(e)}>
          ${all.length
            ? (this._showScript ? this.#scriptView(state, all, linked, runs) : this.#framesOnly(state, all, linked, runs))
            : html`<div class="noboards">
                <img src="/boards-empty.png" alt="">
                <p>drop ${reference ? 'reference images' : 'images'} here to use as storyboard panels</p>
              </div>`}
        </div>
        <pd-segmented class="modes" label="Which frame of each storyboard to show"
          .options=${MODE_OPTIONS} .value=${this._mode}
          @change=${(e) => { this._mode = e.detail.value; }}></pd-segmented>
      </div>
      <input type="file" id="fileImg" accept=${BOARD_MEDIA_ACCEPT} multiple style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }
}

customElements.define('pandemonium-boards-panel', PandemoniumBoardsPanel);

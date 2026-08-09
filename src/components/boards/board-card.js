'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL, isVideoSrc, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import './bokeh.js';
import '../../components/ui/button.js';

// One storyboard frame (Figma node 82-149). The image is the card; its controls
// live on hover, not in a permanent button strip:
//   - hovering a linked frame shows a small Edit / Delete menu at the top right;
//   - opening Edit or Delete blurs the frame (WebGL bokeh, see bokeh.js -- CSS
//     blur for video, which has no still texture to sample) and floats the
//     detail options over it;
//   - an unlinked frame shows "Link here" centered instead.
// `resolved` is the {bd, res, ok, sceneIdx} entry the panel already computed.
export class PandemoniumBoardCard extends LitElement {
  // `run` is {index, length}: where this board sits among the boards sharing
  // its passage. Computed by the panel (project-model.boardRuns).
  static properties = {
    resolved: { type: Object }, sceneLabel: { type: String }, run: { type: Object },
    // The id of a board on the same section in the other mode (a final beside
    // this reference, or vice versa), if it has an image: when present the
    // marker offers a swap instead of a move.
    counterpartId: {},
    _overlay: { state: true }, // null | 'edit' | 'delete'
    _dropfb: { state: true }, // showing the pink drop caption
  };

  static styles = css`
    /* Images only (per direction): the card is the frame and nothing else --
       no scene tag, caption, or meta text. Controls live on hover. Sharp
       corners to match the windowing design language (Figma 101-1095). */
    :host{display:block}
    .frame{position:relative;aspect-ratio:16/9;background:var(--ph);overflow:hidden;border-radius:0}
    .frame img,.frame video{width:100%;height:100%;object-fit:cover;display:block;background:#000}
    .frame.lost{outline:2px solid var(--warn);outline-offset:-2px}
    .await{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);text-align:center;padding:0 10px}
    /* Drop feedback: the app pink with a caption (replace vs add). */
    .dropfb{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;text-align:center;
      padding:0 10px;background:var(--res);color:#fff;font-family:var(--sans);font-size:12px;font-weight:500;pointer-events:none}

    /* Hover menu: white pills bottom-right (top-left holds the Final/Reference
       marker), revealed on frame hover. */
    .menu{position:absolute;bottom:6px;right:6px;z-index:3;display:flex;gap:4px;align-items:flex-end;
      opacity:0;transition:opacity .12s;pointer-events:none}
    .frame:hover .menu{opacity:1;pointer-events:auto}
    /* Final / Reference marker: a dropdown pill at the top-left, revealed on
       hover, letting each frame be set independently. */
    .marker{position:absolute;top:6px;left:6px;z-index:3;opacity:0;transition:opacity .12s;pointer-events:none}
    .frame:hover .marker{opacity:1;pointer-events:auto}
    .marker.ref{background:var(--res);color:#fff}
    /* Label shows the current state; the action (move/swap) shows on hover. */
    .marker .act{display:none}
    .marker:hover .rest{display:none}
    .marker:hover .act{display:inline}
    .pill{font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;padding:5px 9px;border:0;border-radius:20px;
      cursor:pointer;background:#fff;color:#161719;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}
    .pill:hover{background:#f0f0f0}
    .pill.danger{color:var(--danger)}
    .pill.go{background:var(--act);color:var(--act-ink)}

    /* Link here, for an unlinked frame. */
    .linkhere{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3;
      opacity:0;transition:opacity .12s;pointer-events:none}
    .frame:hover .linkhere{opacity:1;pointer-events:auto}
    .linkhere .pill{background:var(--res);color:#fff}

    /* The bokeh/edit overlay shown when Edit or Delete is opened. */
    .overlay{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
    .overlay .scrim{position:absolute;inset:0;background:rgba(0,0,0,.35)}
    .overlay .vblur{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(14px)}
    .group{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:5px}
    .glabel{font-family:var(--sans);font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
    .row{display:flex;gap:5px;flex-wrap:wrap;justify-content:center}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._overlay = null;
  }

  updated() {
    if (this.resolved) this.setAttribute('data-board-id', this.resolved.bd.id);
  }

  #jump() {
    const store = this._store.store;
    const fsc = store.getFinalState().fsc;
    const r = this.resolved.res.find(Boolean);
    const patch = {};
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    if (r) patch.scrollToBlock = r.bi;
    store.setUI(patch);
  }

  #relink() {
    this._overlay = null;
    this._store.store.setUI({ pendingRelink: { type: 'board', id: this.resolved.bd.id }, draftId: this._store.store.finalScript().id });
  }

  async #pickImage(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) await this.#setImage(file);
  }

  async #setImage(file) {
    const had = !!this.resolved.bd.img;
    const dataUrl = await readFileAsDataURL(file);
    this._overlay = null;
    this._store.store.replaceBoardImage(this.resolved.bd.id, dataUrl);
    dispatch(this, 'pandemonium-toast', { message: had ? 'Image replaced.' : 'Board filled. It counts as boarded now.' });
  }

  #removeImage() {
    this._overlay = null;
    this._store.store.replaceBoardImage(this.resolved.bd.id, null);
    dispatch(this, 'pandemonium-toast', { message: 'Image removed. This is a blank board now and no longer counts as boarded.' });
  }

  #onDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    this._dropfb = true;
  }
  #onDragLeave() { this._dropfb = false; }
  async #onDrop(e) {
    this._dropfb = false;
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!file) return;
    e.preventDefault(); e.stopPropagation();
    await this.#setImage(file);
  }

  #move(delta) { this._store.store.reorderBoard(this.resolved.bd.id, delta); }
  #delete() { this._store.store.deleteBoard(this.resolved.bd.id); }
  #unlink() {
    this._overlay = null;
    this._store.store.reattachBoard(this.resolved.bd.id, []);
    dispatch(this, 'pandemonium-toast', { message: 'Board unlinked from the script. The image is kept.' });
  }

  #replace() { this.renderRoot.querySelector('input[type=file]').click(); }

  // Move this frame to the other mode, or -- when the section already has a
  // frame in that mode -- swap the two so this one takes the other's role.
  #refAction(e) {
    e.stopPropagation();
    const store = this._store.store;
    const bd = this.resolved.bd;
    store.setBoardRef(bd.id, !bd.ref);
    if (this.counterpartId) store.setBoardRef(this.counterpartId, bd.ref);
  }

  #markerLabels(bd) {
    const rest = bd.ref ? 'Reference' : 'Final';
    const act = this.counterpartId
      ? (bd.ref ? 'Swap with final' : 'Swap with reference')
      : (bd.ref ? 'Move to final' : 'Move to reference');
    return { rest, act };
  }

  #frameBackdrop(bd) {
    // The blurred image behind the overlay: real WebGL bokeh for a still, a CSS
    // blur for video (no still frame to sample as a texture).
    if (!bd.img) return html`<div class="scrim"></div>`;
    if (isVideoSrc(bd.img)) return html`<video class="vblur" src=${bd.img} muted></video><div class="scrim"></div>`;
    return html`<pd-bokeh .src=${bd.img} .radius=${16}></pd-bokeh><div class="scrim"></div>`;
  }

  #overlayOptions(o) {
    if (this._overlay === 'delete') {
      return html`
        <div class="group">
          <span class="glabel">Delete this board?</span>
          <div class="row">
            <button class="pill danger" @click=${() => this.#delete()}>Yes, delete</button>
            <button class="pill" @click=${() => { this._overlay = null; }}>Cancel</button>
          </div>
        </div>`;
    }
    // edit
    return html`
      <div class="group">
        <span class="glabel">${o.ok ? 'Link' : 'Not linked'}</span>
        <div class="row">
          ${o.ok
            ? html`<button class="pill" @click=${() => this.#unlink()}>Unlink</button>
                   <button class="pill" @click=${() => this.#relink()}>Relink</button>
                   <button class="pill go" @click=${() => this.#jump()}>Go to script</button>`
            : html`<button class="pill" @click=${() => this.#relink()}>Attach to script</button>`}
        </div>
      </div>
      <div class="group">
        <span class="glabel">Image</span>
        <div class="row">
          <button class="pill" @click=${() => this.#replace()}>${o.bd.img ? 'Replace' : 'Add image'}</button>
          ${o.bd.img ? html`<button class="pill" @click=${() => this.#removeImage()}>Remove</button>` : ''}
          <button class="pill" @click=${() => { this._overlay = null; }}>Done</button>
        </div>
      </div>
      ${this.#reorderGroup()}`;
  }

  // Reordering lives in the Edit overlay now that the frame carries no meta row
  // (images only). Only meaningful when several boards share this passage.
  #reorderGroup() {
    const run = this.run || { index: 0, length: 1 };
    if (run.length < 2) return '';
    return html`
      <div class="group">
        <span class="glabel">Order (${run.index + 1} of ${run.length})</span>
        <div class="row">
          <button class="pill" ?disabled=${run.index === 0} @click=${() => this.#move(-1)}>▲ Earlier</button>
          <button class="pill" ?disabled=${run.index === run.length - 1} @click=${() => this.#move(1)}>▼ Later</button>
        </div>
      </div>`;
  }

  render() {
    const o = this.resolved;
    const bd = o.bd;
    const menu = html`<div class="menu">
      <button class="pill" @click=${() => { this._overlay = 'edit'; }}>Edit</button>
      <button class="pill danger" @click=${() => { this._overlay = 'delete'; }}>Delete</button>
    </div>`;
    return html`
      <div class="frame ${o.ok ? '' : 'lost'}"
        @dragover=${(e) => this.#onDragOver(e)} @dragleave=${(e) => this.#onDragLeave(e)} @drop=${(e) => this.#onDrop(e)}>
        ${bd.img
          ? (isVideoSrc(bd.img)
            ? html`<video src=${bd.img} muted loop playsinline @click=${() => o.ok && this.#jump()}></video>`
            : html`<img alt="" src=${bd.img} @click=${() => o.ok && this.#jump()}>`)
          : html`<span class="await">drop an image here</span>`}

        ${this._dropfb ? html`<div class="dropfb">${bd.img ? 'Replace image for this board' : 'Add image to this board'}</div>` : ''}

        ${this._overlay
          ? html`<div class="overlay">${this.#frameBackdrop(bd)}${this.#overlayOptions(o)}</div>`
          : html`
            <button class="pill marker ${bd.ref ? 'ref' : ''}" @click=${(e) => this.#refAction(e)}
              ><span class="rest">${this.#markerLabels(bd).rest}</span><span class="act">${this.#markerLabels(bd).act}</span></button>
            ${o.ok ? menu : html`<div class="linkhere"><button class="pill" @click=${() => this.#relink()}>Link here</button></div>${menu}`}`}
      </div>
      <input type="file" accept=${BOARD_MEDIA_ACCEPT} style="display:none" @change=${(e) => this.#pickImage(e)}>
    `;
  }
}

customElements.define('pandemonium-board-card', PandemoniumBoardCard);

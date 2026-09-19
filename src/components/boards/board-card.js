'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { readFileAsDataURL, isVideoSrc, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import { fmtT } from '../../utils/format.js';
import { frameImg, otherMode } from '../../data/project-model.js';
import './bokeh.js';
import '../../components/ui/button.js';

// One storyboard, shown as ONE of its two frames (Figma node 82-149): `mode`
// says whether this card is the Final or the Reference view of it. A storyboard
// always has both frames (either may be empty), so the same storyboards appear
// in both views and an empty frame shows as a blank, click-or-drop card, with
// the storyboard's note if it has one. The image is the card; its controls live
// on hover, not in a permanent button strip:
//   - hovering a linked frame shows a small Edit / Unlink menu at the bottom
//     right (Unlink is the frequent action so it stays outside; Delete moves
//     into the Edit overlay). An unlinked frame has no link to unlink, so its
//     menu is Edit / Delete instead. Unlink and Delete act on the whole
//     storyboard, both frames;
//   - the top-left pill moves this image to the other frame, or swaps the two
//     when both are filled; the top-right pill starts the show at this beat;
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
    // Which of the storyboard's two frames this card shows: 'final' | 'reference'.
    mode: { type: String },
    _overlay: { state: true }, // null | 'edit' | 'delete'
    _dropfb: { state: true }, // showing the pink drop caption
  };

  static styles = css`
    /* Images only (per direction): the card is the frame and nothing else --
       no scene tag, caption, or meta text. Controls live on hover. Sharp
       corners to match the windowing design language (Figma 101-1095). */
    :host{display:block}
    /* A step subtler than a button's full pill (20px): the frame is a
       photo, not a control, so it gets a golden-ratio fraction of that
       rounding (20 / 1.618) rather than the same amount or none at all. */
    .frame{position:relative;aspect-ratio:16/9;background:var(--ph);overflow:hidden;border-radius:12.36px}
    .frame img,.frame video{width:100%;height:100%;object-fit:cover;display:block;background:#000}
    .frame.lost{outline:2px solid var(--warn);outline-offset:-2px}
    /* An empty frame: a card of its own (click or drop to fill it), carrying
       the storyboard's note as a description of the shot when it has one. */
    .await{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
      color:var(--mut);text-align:center;padding:14px 18px;cursor:pointer;box-sizing:border-box;overflow:hidden}
    .await:hover{background:var(--ph-hi)}
    .anote{font-family:var(--sans);font-size:14px;line-height:1.35;color:var(--ink);text-transform:none;letter-spacing:normal;
      max-height:70%;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap}
    .ahint{font-size:10px;letter-spacing:.06em;text-transform:uppercase}
    /* A filled frame's note: a small pill at the bottom left, clear of the
       hover controls (top corners, bottom right). */
    .notepill{position:absolute;left:6px;bottom:6px;z-index:2;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;padding:5px 9px;border:0;border-radius:20px;cursor:pointer;
      background:rgba(0,0,0,.55);color:#fff}
    .notepill:hover{background:rgba(0,0,0,.75)}
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
    /* Preview-from-here: top-right, opposite the marker. */
    .preview{position:absolute;top:6px;right:6px;z-index:3;opacity:0;transition:opacity .12s;pointer-events:none}
    .frame:hover .preview{opacity:1;pointer-events:auto}
    /* Label shows the current state; the action (move/swap) shows on hover. */
    .marker .act{display:none}
    .marker:hover .rest{display:none}
    .marker:hover .act{display:inline}
    .pill{font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;padding:5px 9px;border:0;border-radius:20px;
      cursor:pointer;background:#fff;color:#161719;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}
    .pill:hover{background:#f0f0f0}
    /* Move/swap acts like Edit at rest; pink on hover signals "this changes
       the frame's mode," the same pink used for reference elsewhere. */
    .pill.marker:hover{background:var(--res);color:#fff}
    /* Both frames empty: nothing to move, so it names the frame and does nothing. */
    .pill.marker.static{cursor:default;display:inline-block}
    .pill.marker.static:hover{background:#fff;color:#161719}
    .pill.danger{color:var(--danger)}
    .pill.go{background:var(--act);color:var(--act-ink)}

    /* Link here, for an unlinked frame. */
    .linkhere{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3;
      opacity:0;transition:opacity .12s;pointer-events:none}
    .frame:hover .linkhere{opacity:1;pointer-events:auto}
    .linkhere .pill{background:var(--res);color:#fff}

    /* The bokeh/edit overlay shown when Edit or Delete is opened. */
    /* .opts is centered by margin:auto, not by the overlay's justify-content,
       so when the groups are taller than the frame the overlay scrolls from
       the top instead of clipping the first one off. */
    .overlay{position:absolute;inset:0;z-index:4;display:flex;overflow-y:auto;box-sizing:border-box;padding:8px}
    .opts{position:relative;z-index:1;margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px}
    .gnote{position:relative;font-family:var(--sans);font-size:11px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
    .noteinput{width:min(300px,80vw);box-sizing:border-box;resize:none;font-family:var(--sans);font-size:12px;line-height:1.35;
      padding:6px 9px;border:0;border-radius:10px;background:#fff;color:#161719;outline:none}
    .noteinput::placeholder{color:#868686}
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
    this.mode = 'final';
  }

  updated() {
    if (this.resolved) this.setAttribute('data-board-id', this.resolved.bd.id);
  }

  // This card's frame image, and the other frame's.
  #mine() { return frameImg(this.resolved.bd, this.mode); }
  #theirs() { return frameImg(this.resolved.bd, otherMode(this.mode)); }
  #modeName(m = this.mode) { return m === 'reference' ? 'reference' : 'final'; }

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
    const had = !!this.#mine();
    const dataUrl = await readFileAsDataURL(file);
    this._overlay = null;
    this._store.store.replaceBoardImage(this.resolved.bd.id, dataUrl, this.mode);
    const filled = this.mode === 'reference' ? 'Reference frame filled.' : 'Final frame filled. It counts as boarded now.';
    dispatch(this, 'pandemonium-toast', { message: had ? 'Image replaced.' : filled });
  }

  #removeImage() {
    this._overlay = null;
    this._store.store.replaceBoardImage(this.resolved.bd.id, null, this.mode);
    dispatch(this, 'pandemonium-toast', {
      message: this.mode === 'reference'
        ? 'Reference image removed. The storyboard and its final frame are untouched.'
        : 'Final image removed. This frame is empty again and no longer counts as boarded.',
    });
  }

  #saveNote(value) {
    const note = value.trim();
    if (note === (this.resolved.bd.note || '')) return;
    this._store.store.setBoardNote(this.resolved.bd.id, note);
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
    dispatch(this, 'pandemonium-toast', { message: 'Storyboard unlinked from the script. Both frames are kept.' });
  }

  #replace() { this.renderRoot.querySelector('input[type=file]').click(); }

  #clearPacing() {
    this._store.store.setBoardDuration(this.resolved.bd.id, null);
    dispatch(this, 'pandemonium-toast', { message: 'Pacing cleared. This element falls back to a word-count estimate.' });
  }

  // Move this frame's image to the other frame, or swap the two when both are
  // filled. The storyboard itself never moves: it stays on its passage, in
  // both views. Follows the image into the other view so it is seen landing.
  #swapAction(e) {
    e.stopPropagation();
    const store = this._store.store;
    store.swapBoardFrames(this.resolved.bd.id);
    store.setUI({ highlightBoard: this.resolved.bd.id, highlightMode: otherMode(this.mode) });
  }

  #previewFromHere(e) {
    e.stopPropagation();
    dispatch(this, 'pandemonium-open-slideshow', { mode: this.mode, boardId: this.resolved.bd.id });
  }

  // `rest` names the frame this card shows; `act` (on hover) is what clicking
  // does, or null when both frames are empty and there is nothing to move.
  #markerLabels() {
    const other = this.#modeName(otherMode(this.mode));
    const rest = this.mode === 'reference' ? 'Reference' : 'Final';
    const mine = this.#mine(), theirs = this.#theirs();
    let act = null;
    if (mine && theirs) act = `Swap with ${other}`;
    else if (mine) act = `Move to ${other}`;
    else if (theirs) act = `Bring from ${other}`;
    return { rest, act };
  }

  #frameBackdrop(img) {
    // The blurred image behind the overlay: real WebGL bokeh for a still, a CSS
    // blur for video (no still frame to sample as a texture).
    if (!img) return html`<div class="scrim"></div>`;
    if (isVideoSrc(img)) return html`<video class="vblur" src=${img} muted></video><div class="scrim"></div>`;
    return html`<pd-bokeh .src=${img} .radius=${16}></pd-bokeh><div class="scrim"></div>`;
  }

  #overlayOptions(o) {
    if (this._overlay === 'delete') {
      const theirs = this.#theirs();
      const other = this.#modeName(otherMode(this.mode));
      return html`
        <div class="opts">
          <div class="group">
            <span class="glabel">Delete this storyboard?</span>
            ${theirs ? html`<span class="gnote">Its ${other} image goes with it.</span>` : ''}
            <div class="row">
              <button class="pill danger" @click=${() => this.#delete()}>Yes, delete</button>
              <button class="pill" @click=${() => { this._overlay = null; }}>Cancel</button>
            </div>
          </div>
        </div>`;
    }
    // edit
    const mine = this.#mine();
    return html`
      <div class="opts">
        <div class="group">
          <span class="glabel">${o.ok ? 'Link' : 'Not linked'}</span>
          <div class="row">
            ${o.ok
              ? html`<button class="pill" @click=${() => this.#relink()}>Relink</button>
                     <button class="pill go" @click=${() => this.#jump()}>Go to script</button>
                     <button class="pill danger" @click=${() => { this._overlay = 'delete'; }}>Delete</button>`
              : html`<button class="pill" @click=${() => this.#relink()}>Attach to script</button>`}
          </div>
        </div>
        <div class="group">
          <span class="glabel">${this.mode === 'reference' ? 'Reference' : 'Final'} image</span>
          <div class="row">
            <button class="pill" @click=${() => this.#replace()}>${mine ? 'Replace' : 'Add image'}</button>
            ${mine ? html`<button class="pill" @click=${() => this.#removeImage()}>Remove</button>` : ''}
            <button class="pill" @click=${() => { this._overlay = null; }}>Done</button>
          </div>
        </div>
        <div class="group">
          <span class="glabel">Note (this storyboard only)</span>
          <textarea class="noteinput" rows="2" placeholder="Shot idea, framing, what this beat needs..."
            .value=${o.bd.note || ''} @change=${(e) => this.#saveNote(e.target.value)}
            @keydown=${(e) => e.stopPropagation()}></textarea>
        </div>
        ${this.#pacingGroup(o.bd)}
        ${this.#reorderGroup()}
      </div>`;
  }

  // Only shown once this board actually has a measured duration (recorded by
  // stepping the slideshow in record mode, see timeline.js's Record Pacing).
  // Clearing it is the only way back to a word-count estimate short of
  // re-recording over it, since setBoardDuration otherwise only overwrites.
  #pacingGroup(bd) {
    if (!bd.dur) return '';
    return html`
      <div class="group">
        <span class="glabel">Pacing: ${fmtT(bd.dur)} measured</span>
        <div class="row">
          <button class="pill" @click=${() => this.#clearPacing()}>Clear pacing</button>
        </div>
      </div>`;
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
    const img = this.#mine();
    const labels = this.#markerLabels();
    // Unlink is the frequent action and lives outside now; Delete moves
    // inside the Edit overlay for a linked board, but stays outside for an
    // already-unlinked one, which has no link to unlink.
    const menu = html`<div class="menu">
      <button class="pill" @click=${() => { this._overlay = 'edit'; }}>Edit</button>
      ${o.ok
        ? html`<button class="pill" @click=${() => this.#unlink()}>Unlink</button>`
        : html`<button class="pill danger" @click=${() => { this._overlay = 'delete'; }}>Delete</button>`}
    </div>`;
    // An empty frame is a card of its own, not a hole: click or drop to fill
    // it, and the storyboard's note, if any, reads here as a description of the
    // shot that is still to be drawn.
    const hint = this.mode === 'reference' ? 'Click or drop a reference image' : 'Click or drop the final image';
    const blank = html`<div class="await" @click=${() => this.#replace()}>
      ${bd.note ? html`<span class="anote">${bd.note}</span>` : ''}
      <span class="ahint">${hint}</span>
    </div>`;
    return html`
      <div class="frame ${o.ok ? '' : 'lost'}"
        @dragover=${(e) => this.#onDragOver(e)} @dragleave=${(e) => this.#onDragLeave(e)} @drop=${(e) => this.#onDrop(e)}>
        ${img
          ? (isVideoSrc(img)
            ? html`<video src=${img} muted loop playsinline @click=${() => o.ok && this.#jump()}></video>`
            : html`<img alt="" src=${img} @click=${() => o.ok && this.#jump()}>`)
          : blank}

        ${img && bd.note ? html`<button class="notepill" title=${bd.note} @click=${() => { this._overlay = 'edit'; }}>${bd.note}</button>` : ''}

        ${this._dropfb ? html`<div class="dropfb">${img ? 'Replace this image' : 'Add this image'}</div>` : ''}

        ${this._overlay
          ? html`<div class="overlay">${this.#frameBackdrop(img)}${this.#overlayOptions(o)}</div>`
          : html`
            ${labels.act
              ? html`<button class="pill marker" @click=${(e) => this.#swapAction(e)}
                  ><span class="rest">${labels.rest}</span><span class="act">${labels.act}</span></button>`
              : html`<span class="pill marker static"><span class="rest">${labels.rest}</span></span>`}
            ${o.ok ? html`<button class="pill preview" title="Play the show starting at this beat" @click=${(e) => this.#previewFromHere(e)}>Preview from here</button>` : ''}
            ${o.ok ? menu : html`<div class="linkhere"><button class="pill" @click=${() => this.#relink()}>Link here</button></div>${menu}`}`}
      </div>
      <input type="file" accept=${BOARD_MEDIA_ACCEPT} style="display:none" @change=${(e) => this.#pickImage(e)}>
    `;
  }
}

customElements.define('pandemonium-board-card', PandemoniumBoardCard);

'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { sectionsOf } from '../fountain/blocks.js';
import { fmtT } from '../utils/format.js';
import { dispatch } from '../utils/events.js';
import { describeSlideshowGap } from '../state/selectors.js';
import { panelStyles } from '../styles/shared.js';
import { readFileAsDataURL, isBoardMediaFile } from '../utils/files.js';
import '../components/ui/panel-picker.js';
import '../components/ui/button.js';

// Timeline (Figma node 100-208): a "torrent" coverage view. Two rows,
// Storyboarded and Sourced, run the length of the written script. Every
// paragraph element (a scene heading, an action line, a cue, a speech) is one
// bar; its width is that element's estimated screen time (word count over a
// reading pace). A bar is coloured where that specific element is linked (a
// board with an image on the Storyboarded row, a source on the Sourced row) and
// left grey where it is not, so at a glance it reads like a download's received
// chunks. Act boundaries (top-level Fountain sections) are marked with a
// labelled divider through both rows. The overall boarded/sourced PERCENTAGES
// moved to the Project Status panel; this panel is the where, not the how much.
//
// Honest math (hard rule 3): a bar is only coloured where an anchor actually
// resolves onto that element, and the width is the reading-pace estimate, not a
// guess -- when pacing is recorded (slideshow) it can replace this estimate
// per element.
const BAR_TYPES = new Set(['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'centered', 'lyric']);
const SPOKEN = new Set(['dialogue', 'paren', 'lyric']);

// One element's estimated screen time from its word count: spoken lines read
// slower than action description. A floor keeps a near-wordless element (a scene
// heading, a cue) a visible sliver rather than a zero-width bar.
function elementSeconds(b) {
  const w = b.words || 0;
  return Math.max(0.4, SPOKEN.has(b.type) ? w / 2.4 : w / 4.5);
}

export class PandemoniumTimeline extends LitElement {
  static properties = { leafId: {}, _dragBi: { state: true } };

  static styles = [panelStyles, css`
    .chrome .est{align-self:center;margin-left:auto;padding-right:10px;font-size:11px;color:var(--mut);white-space:nowrap}
    .chrome .est b{color:var(--res);font-weight:500}
    .chrome .tools{align-self:center;padding-right:6px;display:flex;gap:4px}

    /* overflow:hidden (panelStyles sets auto): the bars thin as the pane
       shrinks instead of scrolling. Extra bottom padding leaves room for the
       act labels that hang below the lower bar. */
    .pbody{display:flex;flex-direction:column;padding:10px 10px 20px;overflow:hidden}
    .tlbody{flex:1;min-height:0;display:flex;align-items:center;gap:12px}

    .labels{flex:none;display:flex;flex-direction:column;gap:4px}
    .lab{font-size:11px;font-weight:500;white-space:nowrap}
    .lab.b{color:var(--board-ink)}
    .lab.r{color:var(--res)}

    .strip{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
    /* One bar per paragraph element, sized by its estimated seconds (flex-grow).
       The 1px gap shows the track's grey through, which is what separates the
       chunks; an unlinked element is transparent (reads as the grey track), a
       linked one takes its row colour. */
    /* Rounded one step down the app's radius scale, which divides by the golden
       ratio each step: 20px panels, 12.36px storyboard frames, 7.64px here.
       That keeps the bars in the same family as the pane they sit in without
       turning a 22px bar into a pill (which would be 11px). overflow:hidden
       lets the first and last segment take the track's corners. */
    .track{position:relative;height:22px;display:flex;gap:1px;background:var(--ph);overflow:hidden;border-radius:7.64px}
    .seg{position:relative;min-width:2px;cursor:pointer;background:transparent}
    /* Final storyboard is solid green, reference-only is solid yellow (the
       same green/yellow split the editor highlight, minimap and script view
       use). This replaced a green hatch for reference: a plain color reads
       faster than a diagonal at this bar height, and needs no shared
       pattern origin to stay seamless across adjacent bars. */
    .track.b .seg.on{background:var(--board-strong)}
    .track.b .seg.ref{background:var(--act)}
    .track.r .seg.on{background:var(--res)}
    .seg:hover{outline:1px solid var(--ui);outline-offset:-1px;z-index:2}
    /* Click-to-jump flash: --ui rather than --act, which would vanish on a
       yellow reference bar. */
    .track .seg.flash{background:var(--ui)}
    /* Dragging a file over a specific element: a solid pink outline marks
       exactly which element the drop will attach to (see .dragcard below for
       the accompanying label, since the browser won't hand over the image's
       bytes to preview until the drop actually happens). */
    .track.b .seg.dragover{outline:2px solid var(--res);outline-offset:-2px;z-index:2}
    /* A measured duration (recorded in the slideshow) vs. a word-count guess:
       the only place today that told them apart was the header label, one
       word for the whole project even if just one element was ever recorded.
       This marks the specific bars that are measured. --ui (dark) so the
       tick reads on both the green and the yellow bar. */
    .track.b .seg.paced::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--ui)}
    .none{flex:1;background:var(--ph);opacity:.45;border-radius:7.64px}

    /* Act markers span both bars, label hanging under the lower one. */
    .markers{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none}
    .mark{position:absolute;top:0;bottom:0;width:2px;background:var(--ui)}
    .mark span{position:absolute;bottom:-15px;left:3px;font-size:8px;font-weight:600;
      letter-spacing:.05em;color:var(--mut);white-space:nowrap;text-transform:uppercase}

    /* The floating card that names the target element while a file is
       dragged over the Storyboarded row. */
    .dragcard{position:fixed;z-index:80;max-width:280px;padding:6px 10px;border-radius:var(--r);
      background:var(--res);color:#fff;font-family:var(--sans);font-size:11px;line-height:1.4;
      pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25);transform:translate(-50%,-100%);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._dragBi = null;
  }

  #jump(bi, el) {
    const store = this._store.store;
    const fsc = store.getFinalState().fsc;
    const patch = { scrollToBlock: bi };
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    store.setUI(patch);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 700);
  }

  // Every drawable paragraph element as a bar, with its estimated seconds and
  // whether it is boarded / sourced (an anchor resolves onto its block index).
  #elements(state) {
    // A storyboard with a final image draws green; one whose only image is the
    // reference draws yellow. An element with a final image is "final" even if
    // it also has a reference one, and a blank storyboard (no image in either
    // frame) draws nothing: it is claimed, not drawn (hard rule 3).
    const finalSet = new Set();
    const refSet = new Set();
    const durByBi = new Map(); // recorded pacing (board.dur) mapped onto the element it lands on
    for (const it of state.R.boards) {
      if (!it.ok) continue;
      const hasFinal = !!it.bd.img;
      if (!hasFinal && !it.bd.refImg) continue;
      (it.res || []).forEach((r) => {
        if (!r) return;
        (hasFinal ? finalSet : refSet).add(r.bi);
        if (it.bd.dur) durByBi.set(r.bi, Math.max(durByBi.get(r.bi) || 0, it.bd.dur));
      });
    }
    const sourced = new Set();
    for (const it of state.R.links) if (it.ok) (it.res || []).forEach((r) => r && sourced.add(r.bi));
    return state.fparsed.blocks
      .filter((b) => b.line != null && BAR_TYPES.has(b.type) && b.plain && b.plain.trim())
      .map((b) => ({
        bi: b.i, type: b.type,
        secs: durByBi.get(b.i) || elementSeconds(b),
        paced: durByBi.has(b.i),
        // Reference-only sits out of "boarded" too (see coverage() in
        // selectors.js): refOnly below is what still lights the bar hatched.
        boarded: finalSet.has(b.i),
        refOnly: !finalSet.has(b.i) && refSet.has(b.i),
        sourced: sourced.has(b.i),
      }));
  }

  // Dropping a file on a specific element of the Storyboarded row attaches a
  // new board straight to that element's whole passage (same anchor shape
  // script-editor.js uses for a section board: the block's full plain text).
  // The browser only hands over file bytes on the actual drop, not while
  // dragging, so the "which element" question is answered live via the
  // outline + #dragcard label, and the "here's the image" confirmation only
  // exists after drop (the board flashes into view via highlightBoard).
  #onSegDragOver(e, kind, el) {
    if (kind !== 'b') return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (this._dragBi !== el.bi) this._dragBi = el.bi;
  }

  #onSegDragLeave(e, kind) {
    if (kind !== 'b') return;
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    this._dragBi = null;
  }

  async #onSegDrop(e, kind, el, state) {
    if (kind !== 'b') return;
    e.preventDefault();
    this._dragBi = null;
    const file = [...(e.dataTransfer.files || [])].find(isBoardMediaFile);
    if (!file) return;
    const b = state.fparsed.blocks[el.bi];
    if (!b) return;
    const store = this._store.store;
    const img = await readFileAsDataURL(file);
    const mode = store.project.dropToReference !== false ? 'reference' : 'final';
    // Fills that frame of a storyboard already on this element if it is empty,
    // else starts one (its other frame empty).
    const board = store.placeFrame({ parts: [{ q: b.plain, b: b.i, s: 0 }], img, caption: '', mode });
    store.setUI({ highlightBoard: board.id, highlightMode: mode });
    dispatch(this, 'pandemonium-toast', { message: 'Board added and linked to that line.' });
  }

  // The floating label that names the target element while dragging, since
  // there is no image to preview yet (see the comment above #onSegDragOver).
  #dragCard(state) {
    if (this._dragBi == null) return '';
    const b = state.fparsed.blocks[this._dragBi];
    const el = this.renderRoot.querySelector(`.seg[data-bi="${this._dragBi}"]`);
    if (!b || !el) return '';
    const r = el.getBoundingClientRect();
    const text = (b.plain || '').trim();
    const excerpt = text.length > 70 ? text.slice(0, 70) + '...' : text;
    return html`<div class="dragcard" style="left:${r.left + r.width / 2}px;top:${r.top - 8}px">Link to: ${excerpt || b.type}</div>`;
  }

  #recordPacing() {
    // Opens the slideshow in record mode: stepping through it times each beat
    // and saves the pacing, which then drives these bars and the duration.
    // Record mode always plays the final storyboard (there is no mode toggle
    // here), so the gap check looks at 'final' specifically.
    const state = this._store.store.getFinalState();
    const gap = describeSlideshowGap(state.fparsed, state.R.boards, 'final', 'record pacing');
    if (gap) { dispatch(this, 'pandemonium-toast', { message: gap }); return; }
    dispatch(this, 'pandemonium-open-slideshow', { record: true });
  }

  // Top-level act (section level 1) boundaries as x-percentages of the running
  // time, each at the start of the first element at or after the section.
  #markers(els, parsed, total) {
    if (!total) return [];
    const cum = [];
    let acc = 0;
    els.forEach((el, i) => { cum[i] = acc; acc += el.secs; });
    return sectionsOf(parsed)
      .filter((s) => (s.level || 1) === 1)
      .map((sec) => {
        const ei = els.findIndex((el) => el.bi >= sec.start);
        if (ei < 0) return null;
        return { x: (cum[ei] / total) * 100, name: sec.name };
      })
      .filter((m) => m && m.x > 0.5 && m.x < 99.5);
  }

  #barTitle(el, kind) {
    if (kind === 'b') {
      const status = el.refOnly ? 'reference only' : el.boarded ? 'storyboarded' : 'not storyboarded yet';
      const pacing = el.paced ? ', measured pacing' : ', estimated from word count';
      return `${el.type} · ~${fmtT(el.secs)} · ${status}${pacing}`;
    }
    return `${el.type} · ~${fmtT(el.secs)} · ${el.sourced ? 'sourced' : 'not sourced yet'}`;
  }

  #track(kind, els, state) {
    return html`<div class="track ${kind}">
      ${els.map((el) => {
        const on = kind === 'b' ? el.boarded : el.sourced;
        const refOnly = kind === 'b' && el.refOnly;
        const dragover = kind === 'b' && this._dragBi === el.bi;
        const paced = kind === 'b' && el.paced;
        return html`
        <div class="seg ${on ? 'on' : ''} ${refOnly ? 'ref' : ''} ${dragover ? 'dragover' : ''} ${paced ? 'paced' : ''}"
          data-bi=${el.bi}
          style="flex-grow:${el.secs}"
          title=${this.#barTitle(el, kind)}
          @click=${(e) => this.#jump(el.bi, e.currentTarget)}
          @dragover=${(e) => this.#onSegDragOver(e, kind, el)}
          @dragleave=${(e) => this.#onSegDragLeave(e, kind)}
          @drop=${(e) => this.#onSegDrop(e, kind, el, state)}></div>`;
      })}
    </div>`;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const els = this.#elements(state);
    const total = els.reduce((a, e) => a + e.secs, 0);
    const hasContent = els.length > 0;
    const paced = els.some((e) => e.paced);
    const estimate = hasContent ? fmtT(total) : 'unknown';
    const markers = total ? this.#markers(els, state.fparsed, total) : [];

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          <pd-panel-picker current="timeline" .leafId=${this.leafId}></pd-panel-picker>
          <span class="est" title=${paced ? 'Running time from recorded pacing' : 'Estimated running time (reading pace). Record pacing for a measured figure.'}>
            ${paced ? 'duration' : 'estimated duration'} : <b>~${estimate}</b>${project.targetMins ? html` of ${project.targetMins}:00` : ''}
          </span>
          <div class="tools">
            <pd-button @click=${() => this.#recordPacing()}>Record Pacing</pd-button>
          </div>
        </div>
        <div class="pbody">
          <div class="tlbody">
            <div class="labels">
              <div class="lab b">Storyboarded</div>
              <div class="lab r">Sourced</div>
            </div>
            <div class="strip" data-clarity-mask="true">
              ${!els.length
                ? html`<div class="track"><div class="none"></div></div><div class="track"><div class="none"></div></div>`
                : html`
                  ${this.#track('b', els, state)}
                  ${this.#track('r', els, state)}
                  <div class="markers">
                    ${markers.map((m) => html`<div class="mark" style="left:${m.x}%"><span>${m.name}</span></div>`)}
                  </div>`}
            </div>
          </div>
        </div>
        ${this.#dragCard(state)}
      </div>
    `;
  }
}

customElements.define('pandemonium-timeline', PandemoniumTimeline);

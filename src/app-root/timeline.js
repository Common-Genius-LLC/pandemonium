'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { sectionsOf } from '../fountain/blocks.js';
import { fmtT } from '../utils/format.js';
import { dispatch } from '../utils/events.js';
import { describeSlideshowGap, elementSeconds, boardSpans } from '../state/selectors.js';
import { soundOnBoards } from '../data/audio-model.js';
import { colorDot } from '../data/research-doc.js';
import { keyColor, knownKeyColor, readableKeyColor } from '../utils/key-color.js';
import { frameImg } from '../data/project-model.js';
import { isVideoSrc } from '../utils/files.js';
import { panelStyles } from '../styles/shared.js';
import { readFileAsDataURL, isBoardMediaFile } from '../utils/files.js';
import '../components/ui/panel-picker.js';
import '../components/ui/button.js';

// Timeline (Figma node 100-208): a "torrent" coverage view. Three rows,
// Storyboarded, Sourced and Sound, run the length of the written script. Every
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

// A bar's width is elementSeconds(b), the reading-pace estimate, which now
// lives in state/selectors.js: the sound panel measures the storyboard with the
// same ruler, and two copies of a pace would drift.

export class PandemoniumTimeline extends LitElement {
  static properties = { leafId: {}, _dragBi: { state: true }, _peek: { state: true } };

  static styles = [panelStyles, css`
    .chrome .est{align-self:center;margin-left:auto;padding-right:10px;font-size:11px;color:var(--mut);white-space:nowrap}
    .chrome .est b{color:var(--res);font-weight:500}
    .chrome .tools{align-self:center;padding-right:6px;display:flex;gap:4px}

    /* No horizontal scroll (panelStyles sets auto both ways): the bars thin as
       the pane shrinks instead of scrolling. Vertically it may scroll, which
       since the Sound row joined the other two is the difference between a
       squeezed strip hiding a row and a squeezed strip you can reach into.
       Extra bottom padding leaves room for the act labels that hang below the
       bottom row. */
    .pbody{display:flex;flex-direction:column;padding:10px 10px 16px;overflow-x:hidden;overflow-y:auto}
    .tlbody{flex:1;min-height:0;display:flex;align-items:center;gap:12px}

    .labels{flex:none;display:flex;flex-direction:column;gap:4px}
    .lab{font-size:11px;font-weight:500;white-space:nowrap}
    .lab.b{color:var(--board-ink)}
    .lab.r{color:var(--res)}
    .lab.s{color:var(--sound)}

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
    .track{position:relative;height:20px;display:flex;gap:1px;background:var(--ph);overflow:hidden;border-radius:7.64px}
    .seg{position:relative;min-width:2px;cursor:pointer;background:transparent}
    /* Storyboard row, three states and nothing else. A beat drawn with a FINAL
       frame is solid in that frame's key colour; a beat whose storyboard holds
       only a REFERENCE frame is the same key colour hatched, because it is the
       beat as it was imagined and not as it will be shot; a BLANK storyboard
       is a flat grey, a claim on the passage with no picture in it yet. The
       hatch, not a second hue, is what carries final against reference now
       that both bars are painted the colour of their own frame: two frames of
       the same shot would otherwise be told apart by nothing. The hatch is
       drawn per bar rather than once across the row (which is how it was
       drawn when every reference bar was the same orange), since each bar
       now carries its own colour. */
    .track.b .seg.ref{
      background-color:color-mix(in srgb, var(--seg, var(--board-ref)) 24%, transparent);
      background-image:repeating-linear-gradient(45deg,
        var(--seg, var(--board-ref)) 0 3px, transparent 3px 7px);
    }
    .track.b .seg.blank{background:var(--note-plain-dot)}
    /* Reference row: one band per source backing the beat, equal widths, each
       in that source's own colour (plain grey where it has none). The seg
       itself stays transparent and the bands fill it, so one source looks like
       a solid bar and several read as the sources they are. */
    .track.r .seg{display:flex}
    .track.r .seg i{flex:1;min-width:0}
    /* Sound: the mixdown of every track. A bar takes the colour of whichever
       clip covers most of its beat (--seg, set per bar from the clip's own
       colour tag), so a project where music is blue and effects are pink reads
       that way here too; untagged sound is the plain sound orange. A beat only
       partly covered is drawn at the same strength: this row says whether a
       beat has been taken into the sonic world, not how densely. */
    .track.s .seg.on{background:var(--seg,var(--sound))}
    .seg:hover{outline:1px solid var(--ui);outline-offset:-1px;z-index:2}
    /* Click-to-jump flash: --ui rather than --act, which would vanish on a
       yellow reference bar. */
    .track .seg.flash{background:var(--ui)}
    /* The click-to-jump flash paints the bar itself, which on the Reference
       row is behind its bands: they step aside for it rather than hide it. */
    .track.r .seg.flash i{opacity:0}
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
    /* A boarded beat is drawn in its own frame's key colour (--seg, see
       utils/key-color.js), so the row reads as the film's palette down its
       length. The storyboard green is what a beat shows while its colour is
       still being read, and what it keeps if the frame cannot be read at all
       (a video, which has no still to read without decoding it). */
    .track.b .seg.on{background:var(--seg,var(--board-strong))}
    .none{flex:1;background:var(--ph);opacity:.45;border-radius:7.64px}

    /* Hovering a boarded beat shows the frame itself, floating free: no border,
       no caption, no arrow. The bar is often two pixels wide, so the picture is
       the only way to know which beat you are on. */
    .peek{
      position:fixed;z-index:80;pointer-events:none;transform:translate(-50%,-100%);
      border-radius:7.64px;overflow:hidden;box-shadow:var(--elev-8);
      animation:peek-in var(--dur-1) var(--ease-out);
    }
    @keyframes peek-in{from{opacity:0}}
    .peek img{display:block;width:200px;height:auto;max-height:50vh;object-fit:cover}

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
    this._peek = null;
  }

  // The frame floating over the row while the pointer is on its bar. Only the
  // Storyboard row, and only where there is a frame to show.
  #peek(kind, el, barEl) {
    const want = kind === 'b' && el && el.frame && barEl
      ? { img: el.frame, rect: barEl.getBoundingClientRect() }
      : null;
    if (!want && !this._peek) return;
    if (want && this._peek && this._peek.img === want.img) return;
    this._peek = want;
  }

  // Key colours are read from the frames themselves, asynchronously and once
  // per image (utils/key-color.js). Kicked off for whatever is on screen after
  // each render; each answer that was not already known brings the row back to
  // paint that bar in it.
  #readKeyColors(els) {
    const want = [...new Set(els.filter((el) => el.frame).map((el) => el.frame))]
      .filter((src) => knownKeyColor(src) == null);
    if (!want.length) return;
    Promise.all(want.map((src) => keyColor(src))).then((out) => {
      if (out.some(Boolean)) this.requestUpdate();
    });
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
    // How each beat is storyboarded, and which of the storyboard's two frames
    // the row draws it from. A final frame outranks a reference one wherever a
    // beat has both, because the final frame is the film and the reference is
    // what it was drawn against; a storyboard with no image in either frame
    // outranks nothing, and draws grey: it is a claim on the passage, not a
    // picture, and it is not boarded (hard rule 3). The frame is kept for the
    // bar's key colour and for the picture shown on hover.
    const MODE_RANK = { final: 2, reference: 1, blank: 0 };
    const boardByBi = new Map(); // bi -> { mode, frame }
    const durByBi = new Map(); // recorded pacing (board.dur) mapped onto the element it lands on
    for (const it of state.R.boards) {
      if (!it.ok) continue;
      const img = frameImg(it.bd, 'final');
      const refImg = frameImg(it.bd, 'reference');
      const mode = img ? 'final' : refImg ? 'reference' : 'blank';
      // Video has no still to read a colour from without decoding it, so it
      // keeps the row's plain colour for its mode.
      const shown = mode === 'final' ? img : mode === 'reference' ? refImg : null;
      const frame = shown && !isVideoSrc(shown) ? shown : null;
      (it.res || []).forEach((r) => {
        if (!r) return;
        const prev = boardByBi.get(r.bi);
        if (!prev || MODE_RANK[mode] > MODE_RANK[prev.mode]) boardByBi.set(r.bi, { mode, frame });
        if (mode !== 'blank' && it.bd.dur) durByBi.set(r.bi, Math.max(durByBi.get(r.bi) || 0, it.bd.dur));
      });
    }
    const project = this._store.project;
    // The Reference row draws a beat in the colours of the sources backing it.
    // A source carries one of the six project colours and a beat backed by
    // several is divided equally between them, so no source it rests on is
    // hidden behind another. A source with no colour of its own is the plain
    // grey the swatch row calls Plain, which is also what a source that has
    // since been deleted out from under its link reads as.
    const colorOfRef = new Map((project.research || []).map((d) => [d.id, d.color || null]));
    const refsByBi = new Map(); // bi -> Map(researchId -> colour key), one band each
    for (const it of state.R.links) {
      if (!it.ok) continue;
      (it.res || []).forEach((r) => {
        if (!r) return;
        let seen = refsByBi.get(r.bi);
        if (!seen) refsByBi.set(r.bi, (seen = new Map()));
        if (!seen.has(it.lk.researchId)) seen.set(it.lk.researchId, colorOfRef.get(it.lk.researchId) || null);
      });
    }
    // Sound is anchored to the storyboards (see data/audio-model.js), so it
    // reaches a script element through the board that element is boarded as.
    // An element with no board can carry no sound, which is the model being
    // honest rather than this row being incomplete.
    const soundByBi = new Map();
    if ((project.clips || []).length) {
      const spans = boardSpans(state.fparsed.blocks, state.R.boards);
      const on = soundOnBoards(project, spans);
      for (const it of state.R.boards) {
        if (!it.ok) continue;
        const hit = on.get(it.bd.id);
        if (!hit) continue;
        (it.res || []).forEach((r) => {
          if (!r) return;
          const prev = soundByBi.get(r.bi);
          if (!prev || hit.secs > prev.secs) soundByBi.set(r.bi, hit);
        });
      }
    }
    return state.fparsed.blocks
      .filter((b) => b.line != null && BAR_TYPES.has(b.type) && b.plain && b.plain.trim())
      .map((b) => {
        const bd = boardByBi.get(b.i) || null;
        return {
          bi: b.i, type: b.type,
          secs: durByBi.get(b.i) || elementSeconds(b),
          paced: durByBi.has(b.i),
          // Reference-only and blank both sit out of "boarded" (see coverage()
          // in selectors.js): only a final frame is a beat that is drawn.
          boarded: !!bd && bd.mode === 'final',
          refOnly: !!bd && bd.mode === 'reference',
          blank: !!bd && bd.mode === 'blank',
          frame: bd ? bd.frame : null,
          sources: [...(refsByBi.get(b.i) || new Map()).values()],
          sound: soundByBi.get(b.i) || null,
        };
      });
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

  // The frame itself, floating over the bar the pointer is on. Positioned from
  // the rect measured when the hover started: the strip does not scroll, so
  // the bar is still exactly there.
  #peekCard() {
    const p = this._peek;
    if (!p) return html``;
    const x = Math.max(110, Math.min(p.rect.left + p.rect.width / 2, innerWidth - 110));
    return html`<div class="peek" style="left:${x}px;top:${p.rect.top - 8}px">
      <img alt="" src=${p.img}>
    </div>`;
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
      const status = el.boarded ? 'storyboarded'
        : el.refOnly ? 'reference frame only, not drawn yet'
          : el.blank ? 'blank storyboard, no frame in it yet'
            : 'not storyboarded yet';
      const pacing = el.paced ? ', measured pacing' : ', estimated from word count';
      return `${el.type} · ~${fmtT(el.secs)} · ${status}${pacing}`;
    }
    if (kind === 's') {
      const hasBoard = el.boarded || el.refOnly || el.blank;
      if (!el.sound) {
        return `${el.type} · ~${fmtT(el.secs)} · ${hasBoard ? 'no sound on this beat yet' : 'storyboard this passage to lay sound on it'}`;
      }
      const how = el.sound.full ? 'sound across the whole beat' : `sound over ${fmtT(el.sound.secs)} of this beat`;
      return `${el.type} · ~${fmtT(el.secs)} · ${how} (every track, muted or not)`;
    }
    const n = el.sources.length;
    const backing = !n ? 'not sourced yet' : n === 1 ? 'backed by one reference' : `backed by ${n} references`;
    return `${el.type} · ~${fmtT(el.secs)} · ${backing}`;
  }

  // The colour a bar is painted in, or '' to leave it on its row's own colour.
  // The Storyboard row takes it from the frame it is drawn from, whichever of
  // the storyboard's two frames that is, held back from paper-white so a
  // pencil drawing on white reads as the same grey a storyboard with no colour
  // of its own gets (readableKeyColor).
  #tint(kind, el) {
    if (kind === 's') return el.sound && el.sound.color ? colorDot(el.sound.color) : '';
    if (kind !== 'b' || !el.frame) return '';
    const key = knownKeyColor(el.frame);
    return key ? readableKeyColor(key) : '';
  }

  #track(kind, els, state) {
    return html`<div class="track ${kind}">
      ${els.map((el) => {
        const on = kind === 'b' ? el.boarded : kind === 's' ? !!el.sound : el.sources.length > 0;
        const tint = this.#tint(kind, el);
        const refOnly = kind === 'b' && el.refOnly;
        const blank = kind === 'b' && el.blank;
        const dragover = kind === 'b' && this._dragBi === el.bi;
        const paced = kind === 'b' && el.paced;
        return html`
        <div class="seg ${on ? 'on' : ''} ${refOnly ? 'ref' : ''} ${blank ? 'blank' : ''} ${dragover ? 'dragover' : ''} ${paced ? 'paced' : ''}"
          data-bi=${el.bi}
          style=${`flex-grow:${el.secs}` + (tint ? ';--seg:' + tint : '')}
          title=${this.#barTitle(el, kind)}
          @click=${(e) => this.#jump(el.bi, e.currentTarget)}
          @mouseenter=${(e) => this.#peek(kind, el, e.currentTarget)}
          @mouseleave=${() => this.#peek(null, null, null)}
          @dragover=${(e) => this.#onSegDragOver(e, kind, el)}
          @dragleave=${(e) => this.#onSegDragLeave(e, kind)}
          @drop=${(e) => this.#onSegDrop(e, kind, el, state)}
        >${kind === 'r' ? el.sources.map((c) => html`<i style="background:${colorDot(c)}"></i>`) : ''}</div>`;
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
    // Reading a frame's key colour is asynchronous; ask for whatever is on
    // screen and paint it when it comes back.
    this.#readKeyColors(els);

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
              <div class="lab b">Storyboard</div>
              <div class="lab r">Reference</div>
              <div class="lab s">Sound</div>
            </div>
            <div class="strip" data-clarity-mask="true">
              ${!els.length
                ? html`<div class="track"><div class="none"></div></div><div class="track"><div class="none"></div></div><div class="track"><div class="none"></div></div>`
                : html`
                  ${this.#track('b', els, state)}
                  ${this.#track('r', els, state)}
                  ${this.#track('s', els, state)}
                  <div class="markers">
                    ${markers.map((m) => html`<div class="mark" style="left:${m.x}%"><span>${m.name}</span></div>`)}
                  </div>`}
            </div>
          </div>
        </div>
        ${this.#dragCard(state)}
        ${this.#peekCard()}
      </div>
    `;
  }
}

customElements.define('pandemonium-timeline', PandemoniumTimeline);

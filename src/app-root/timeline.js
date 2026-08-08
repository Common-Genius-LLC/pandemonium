'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { timelineStats } from '../state/selectors.js';
import { sectionsOf } from '../fountain/blocks.js';
import { fmtT } from '../utils/format.js';
import { dispatch } from '../utils/events.js';
import { panelStyles } from '../styles/shared.js';
import '../components/ui/panel-picker.js';
import '../components/ui/button.js';

// Timeline (Figma node 100-208): a "torrent" coverage view. Two rows,
// Storyboarded and Sourced, run the length of the written script. Each is one
// even-celled bar, filled where that stretch of script is boarded / sourced and
// grey where it is not, so at a glance it reads like a download's received
// chunks. Act boundaries (top-level Fountain sections) are marked with a
// labelled divider through both rows. The overall boarded/sourced PERCENTAGES
// moved to the Project Status panel; this panel is the where, not the how much.
//
// Honest math (hard rule 3): the x-axis is the running time of what is WRITTEN
// (unscripted scenes carry 0 seconds and show as a thin grey unwritten slot,
// never a fabricated duration), and a cell is filled only where a scene really
// has a board with an image / a source -- coverage()'s fb/fr fractions.
export class PandemoniumTimeline extends LitElement {
  static properties = { leafId: {} };

  // A scene with no running time still needs to be visible (it exists in the
  // outline, just unwritten), so it gets this fixed sliver rather than a share
  // of the duration it does not have.
  static UNWRITTEN_PX = 10;

  static styles = [panelStyles, css`
    .chrome .est{align-self:center;margin-left:auto;padding-right:10px;font-size:11px;color:var(--mut);white-space:nowrap}
    .chrome .est b{color:var(--res);font-weight:500}
    .chrome .tools{align-self:center;padding-right:6px;display:flex;gap:4px}

    /* overflow:hidden (panelStyles sets auto): the bars thin as the pane
       shrinks instead of scrolling. Extra bottom padding leaves room for the
       act labels that hang below the lower bar. */
    .pbody{display:flex;flex-direction:column;padding:8px 10px 20px;overflow:hidden}
    .tlbody{flex:1;min-height:0;display:flex;align-items:center;gap:12px}

    .labels{flex:none;display:flex;flex-direction:column;gap:4px}
    .lab{font-size:11px;font-weight:500;white-space:nowrap}
    .lab.b{color:var(--board-ink)}
    .lab.r{color:var(--res)}

    .strip{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
    .track{position:relative;height:22px;display:flex;background:var(--ph);overflow:hidden}
    .seg{position:relative;min-width:2px}
    .seg.scripted{cursor:pointer}
    .seg.unwritten{flex:none;opacity:.4}
    .seg .fill{position:absolute;inset:0 auto 0 0}
    .track.b .seg .fill{background:var(--board-strong)}
    .track.r .seg .fill{background:var(--res)}
    .seg.scripted:hover{outline:1px solid var(--ui);outline-offset:-1px;z-index:2}
    .seg.flash{background:var(--act)}
    .seg.flash .fill{background:var(--act)}
    /* Even vertical cell lines over the whole bar (the torrent chunks). Painted
       as a repeating gradient, not nodes, so a long script adds nothing to
       re-render. */
    .track::after{content:"";position:absolute;inset:0;pointer-events:none;
      background-image:linear-gradient(to right, var(--bg) 0 1px, transparent 1px);
      background-size:11px 100%;opacity:.6}
    .none{flex:1;background:var(--ph);opacity:.45}

    /* Act markers span both bars, label hanging under the lower one. */
    .markers{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none}
    .mark{position:absolute;top:0;bottom:0;width:2px;background:var(--ui)}
    .mark span{position:absolute;bottom:-15px;left:3px;font-size:8px;font-weight:600;
      letter-spacing:.05em;color:var(--mut);white-space:nowrap;text-transform:uppercase}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #jump(sc, el) {
    if (!sc.scripted) return;
    const store = this._store.store;
    const fsc = store.getFinalState().fsc;
    const patch = { scrollToBlock: sc.start };
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    store.setUI(patch);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 700);
  }

  #recordPacing() {
    // Pacing is recorded by stepping the slideshow; that flow lands with the
    // slideshow work. Until then this says so rather than silently doing nothing.
    dispatch(this, 'pandemonium-toast', { message: 'Record pacing: step through the slideshow to time each beat. Coming soon.' });
  }

  // Top-level act (section level 1) boundaries as x-percentages of the written
  // running time, each at the start of the first scene at or after the section.
  #markers(scenes, parsed, total) {
    if (!total) return [];
    const cum = [];
    let acc = 0;
    scenes.forEach((sc, i) => { cum[i] = acc; acc += sc.secs; });
    return sectionsOf(parsed)
      .filter((s) => (s.level || 1) === 1)
      .map((sec) => {
        const si = scenes.findIndex((sc) => sc.start >= sec.start);
        if (si < 0) return null;
        return { x: (cum[si] / total) * 100, name: sec.name };
      })
      .filter((m) => m && m.x > 0.5 && m.x < 99.5);
  }

  #segTitle(sc) {
    const where = sc.pre ? 'Opening' : 'Sc ' + sc.label;
    if (!sc.scripted) return `${where} · ${sc.name} · not written yet`;
    const boards = sc.nb === 1 ? '1 board' : sc.nb + ' boards';
    const pending = sc.nbPending ? `, ${sc.nbPending} awaiting an image` : '';
    const sources = sc.nr === 1 ? '1 source' : sc.nr + ' sources';
    return `${where} · ${sc.name} · ~${fmtT(sc.secs)} · ${boards}${pending} · ${sources}`;
  }

  #track(kind, scenes) {
    const fillKey = kind === 'b' ? 'fb' : 'fr';
    return html`<div class="track ${kind}">
      ${scenes.map((sc) => html`
        <div class="seg ${sc.scripted ? 'scripted' : 'unwritten'}"
          style=${sc.scripted ? `flex-grow:${Math.max(0.001, sc.secs)}` : `flex-basis:${PandemoniumTimeline.UNWRITTEN_PX}px`}
          title=${this.#segTitle(sc)}
          @click=${(e) => this.#jump(sc, e.currentTarget)}>
          <div class="fill" style="width:${((sc[fillKey] || 0) * 100).toFixed(1)}%"></div>
        </div>`)}
    </div>`;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const scenes = state.fscenes;
    const stats = timelineStats(scenes, state.fparsed.blocks.length);
    const markers = stats.hasContent ? this.#markers(scenes, state.fparsed, stats.totalSeconds) : [];

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          <pd-panel-picker current="timeline" .leafId=${this.leafId}></pd-panel-picker>
          <span class="est" title="Estimated running time of the written final draft">
            estimated duration : <b>~${stats.hasContent ? stats.estimate : 'unknown'}</b>${project.targetMins ? html` of ${project.targetMins}:00` : ''}
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
            <div class="strip">
              ${!stats.hasContent
                ? html`<div class="track"><div class="none"></div></div><div class="track"><div class="none"></div></div>`
                : html`
                  ${this.#track('b', scenes)}
                  ${this.#track('r', scenes)}
                  <div class="markers">
                    ${markers.map((m) => html`<div class="mark" style="left:${m.x}%"><span>${m.name}</span></div>`)}
                  </div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-timeline', PandemoniumTimeline);

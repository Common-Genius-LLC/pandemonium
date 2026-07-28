'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { timelineStats } from '../state/selectors.js';
import { fmtT } from '../utils/format.js';
import { panelStyles } from '../styles/shared.js';
import '../components/ui/panel-picker.js';

// The coverage strip, formerly the "timesheet" and formerly fixed chrome above
// the layout. It is now an ordinary panel (see data/layout-tree.js), so it can
// be moved, resized, closed, or given a whole pane when it is the thing being
// read. The default layout puts it across the bottom.
//
// One segment per scene, sized proportionally to its estimated screen time,
// each with a boarded lane and a sourced lane. Clicking a segment jumps the
// script panel to that scene.
//
// Two things here are hard rule 3 (the timeline math must be honest) rather
// than styling choices:
//   - an empty final draft has no honest estimate, so the header reads
//     "unknown" and the strip shows one flat lane, never a fabricated "0:00"
//   - the tick marks step up in unit rather than always drawing one line per
//     second, because at a step too fine to resolve they stop being a scale
//     and become a texture that implies precision the strip does not have
export class PandemoniumTimeline extends LitElement {
  static properties = { leafId: {}, _stripWidth: { state: true } };

  // One marker line per second is the intent, but only while a second is wide
  // enough to draw. A 12 minute script in a 900px strip is 720 seconds at
  // 1.25px each, which renders as a grey wash. The step therefore climbs
  // through units a reader already thinks in until the gap clears MIN_GAP,
  // and the strip's tooltip states the step it settled on (see #stripTitle).
  static TICK_STEPS = [1, 5, 10, 30, 60, 300];
  static MIN_TICK_GAP = 6;

  static styles = [panelStyles, css`
    .chrome .est{align-self:center;margin-left:auto;padding-right:8px;font-size:11px;color:var(--mut);white-space:nowrap}
    .chrome .est b{color:var(--ui);font-weight:500}

    /* overflow:hidden, not auto (which panelStyles sets): the strip below
       shrinks vertically instead of scrolling, so a short pane thins the lanes
       rather than growing a scrollbar the panel is too small to use. */
    .pbody{display:flex;flex-direction:column;padding:8px 10px;overflow:hidden}
    .tlbody{flex:1;min-height:0;display:flex;align-items:stretch;gap:10px}

    /* The two figures sit in a left gutter, each one on the row of the lane it
       describes, so the strip is its own legend and nothing has to be read
       top to bottom to be matched up. The 2px gap here is the same gap each
       segment puts between its two lanes, which is what keeps them aligned. */
    .labels{flex:none;display:flex;flex-direction:column;gap:2px}
    .lab{
      flex:1;min-height:0;display:flex;align-items:center;gap:4px;
      font-size:11px;color:var(--mut);white-space:nowrap;
    }
    .lab b{color:var(--ui);font-weight:500}
    .lab.b em{font-style:normal;color:var(--board-ink)}
    .lab.r em{font-style:normal;color:var(--res)}

    #tlStrip{
      flex:1;min-width:0;min-height:0;
      display:flex;gap:6px;
      overflow:auto hidden;
      scrollbar-width:thin;
      scrollbar-color:var(--ph) transparent;
    }
    /* Ticks are painted, not built: at one line per second a feature-length
       script would add hundreds of nodes to be re-rendered on every keystroke.
       --tick is the step as a percentage of total runtime, computed in
       render() from the measured strip width. */
    #tlStrip.ticked{
      background-image:linear-gradient(to right,var(--ph-hi) 0 1px,transparent 1px);
      background-size:var(--tick) 100%;
      background-repeat:repeat-x;
      background-position:left bottom;
    }
    #tlStrip::-webkit-scrollbar{height:6px}
    #tlStrip::-webkit-scrollbar-thumb{background:var(--ph);border-radius:4px}

    .seg{
      position:relative;display:flex;flex-direction:column;gap:2px;min-width:10px;
      cursor:pointer;border-radius:2px;overflow:hidden;flex-basis:12px;
    }
    /* min-height keeps both lanes readable as the panel is squeezed; below
       that the pbody clips rather than scrolls. */
    .seg .lane{flex:1;min-height:5px;background:var(--ph);position:relative;overflow:hidden}
    .seg .lane .fill{position:absolute;inset:0 auto 0 0}
    .seg .lane.b .fill{background:var(--board)}
    .seg .lane.r .fill{background:var(--res)}
    .seg .num{position:absolute;top:3px;left:5px;font-size:9px;font-weight:500;color:var(--ui);opacity:.7;pointer-events:none;z-index:1}
    .seg:hover .lane{background:var(--ph-hi)}
    .seg.flash .lane{background:var(--act)}
    /* An empty final draft has nothing to divide into scenes. One flat lane
       reads as "nothing yet"; per-scene segments would collapse into a couple
       of 12px stubs that look like a rendering fault. */
    #tlStrip .none{flex:1;background:var(--ph);border-radius:2px;opacity:.45}

  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._stripWidth = 0;
    // The tick step depends on how wide the strip actually is, and the strip
    // changes width when a divider is dragged, which writes no store state
    // until release. Observing the element is the only way to stay correct
    // through the drag and through a plain window resize.
    this._ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w !== this._stripWidth) this._stripWidth = w;
    });
  }

  disconnectedCallback() {
    this._ro.disconnect();
    super.disconnectedCallback();
  }

  updated() {
    const strip = this.renderRoot.getElementById('tlStrip');
    if (strip && this._observed !== strip) {
      if (this._observed) this._ro.unobserve(this._observed);
      this._ro.observe(strip);
      this._observed = strip;
    }
    this.renderRoot.querySelectorAll('.seg').forEach((el) => {
      const n = el.querySelector('.num');
      if (n) n.style.display = el.offsetWidth < 32 ? 'none' : '';
    });
  }

  #tickStep(totalSeconds) {
    const width = this._stripWidth;
    if (!totalSeconds || !width) return null;
    const perSecond = width / totalSeconds;
    return PandemoniumTimeline.TICK_STEPS.find((s) => s * perSecond >= PandemoniumTimeline.MIN_TICK_GAP) || null;
  }

  // The scale the marks are drawn at. It used to be a caption under the strip;
  // it is a tooltip now, because the caption was a permanent line of text
  // restating something the eye reads off the marks anyway. It is still stated
  // somewhere rather than dropped: per hard rule 3 a drawn scale that does not
  // say its unit is a number without units.
  #stripTitle(step, stats) {
    if (!stats.hasContent) return 'No script yet, so there is no running time to divide.';
    const scale = !step ? 'Too long to mark individual seconds at this width.'
      : step === 1 ? 'One mark per second.'
        : step < 60 ? `One mark every ${step} seconds.`
          : `One mark every ${step / 60} minutes.`;
    return `Each block is a scene, sized by its estimated screen time. ${scale}`;
  }

  #segTitle(sc) {
    const where = sc.pre ? 'Opening' : 'Sc ' + sc.label;
    const boards = sc.nb === 1 ? '1 board' : sc.nb + ' boards';
    // Pending boards are named separately rather than folded into the count,
    // because they are exactly the difference between what is claimed and what
    // the boarded figure above is willing to report.
    const pending = sc.nbPending ? `, ${sc.nbPending} awaiting an image` : '';
    const sources = sc.nr === 1 ? '1 source' : sc.nr + ' sources';
    return `${where} · ${sc.name} · ~${fmtT(sc.secs)} · ${boards}${pending} · ${sources}`;
  }

  #jump(sc, el) {
    const store = this._store.store;
    const fsc = store.getFinalState().fsc;
    const patch = { scrollToBlock: sc.start };
    if (store.activeScript().id !== fsc.id) patch.draftId = fsc.id;
    store.setUI(patch);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 700);
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const scenes = state.fscenes;
    const stats = timelineStats(scenes, state.fparsed.blocks.length);
    const step = stats.hasContent ? this.#tickStep(stats.totalSeconds) : null;

    return html`
      <div class="shell" style="--pane-bg:var(--pane-research)">
        <div class="chrome">
          <pd-panel-picker current="timeline" .leafId=${this.leafId}></pd-panel-picker>
          <span class="est" title="Estimated running time of the final draft">
            est <b>${stats.hasContent ? stats.estimate : 'unknown'}</b>${project.targetMins ? html` of ${project.targetMins}:00` : ''}
          </span>
        </div>
        <div class="pbody">
          <div class="tlbody">
            <div class="labels">
              <div class="lab b"><b>${stats.pctBoarded}%</b> <em>boarded</em></div>
              <div class="lab r"><b>${stats.pctSourced}%</b> <em>sourced</em></div>
            </div>
            <div id="tlStrip" class=${step ? 'ticked' : ''}
              title=${this.#stripTitle(step, stats)}
              style=${step ? `--tick:${(100 * step) / stats.totalSeconds}%` : ''}>
              ${!stats.hasContent ? html`<div class="none"></div>` : scenes.map((sc) => html`
                <div class="seg" style="flex-grow:${Math.max(0.001, sc.secs)}"
                  title=${this.#segTitle(sc)}
                  @click=${(e) => this.#jump(sc, e.currentTarget)}
                >
                  <span class="num">${sc.label}</span>
                  <div class="lane b"><div class="fill" style="width:${(sc.fb * 100).toFixed(1)}%"></div></div>
                  <div class="lane r"><div class="fill" style="width:${(sc.fr * 100).toFixed(1)}%"></div></div>
                </div>
              `)}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-timeline', PandemoniumTimeline);

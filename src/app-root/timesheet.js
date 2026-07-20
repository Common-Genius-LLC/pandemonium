'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { timesheetStats } from '../state/selectors.js';
import { fmtT } from '../utils/format.js';

// The coverage strip: one segment per scene, sized proportionally to its
// estimated screen time, each with a boarded (green) and sourced (magenta)
// sub-bar. Clicking a segment jumps the script panel to that scene. Per hard
// rule 3, when the final draft is empty there is no honest estimate to show,
// so the header reads "unknown," never a fabricated "0:00".
export class PandemoniumTimesheet extends LitElement {
  static styles = css`
    :host{flex:none;padding:10px 22px 14px;display:block}
    #tsHead{display:flex;align-items:baseline;gap:14px;margin-bottom:8px}
    .lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    #tsStats{color:var(--mut);font-size:11px}
    #tsStats b{color:var(--ui);font-weight:500}
    #tsStats .sb{color:#7fae53;font-weight:500}
    #tsStats .sr{color:var(--res);font-weight:500}
    #tsStrip{display:flex;gap:6px;height:56px}
    .seg{
      position:relative;display:flex;flex-direction:column;gap:2px;min-width:10px;
      cursor:pointer;border-radius:2px;overflow:hidden;flex-basis:12px;
    }
    .seg .lane{flex:1;background:var(--ph);position:relative;overflow:hidden}
    .seg .lane .fill{position:absolute;inset:0 auto 0 0}
    .seg .lane.b .fill{background:var(--board)}
    .seg .lane.r .fill{background:var(--res)}
    .seg .num{position:absolute;top:3px;left:5px;font-size:9px;font-weight:500;color:var(--ui);opacity:.7;pointer-events:none;z-index:1}
    .seg:hover .lane{background:#cfcfcf}
    .seg.flash .lane{background:var(--act)}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  updated() {
    this.renderRoot.querySelectorAll('.seg').forEach((el) => {
      const n = el.querySelector('.num');
      if (n) n.style.display = el.offsetWidth < 32 ? 'none' : '';
    });
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
    const store = this._store.store;
    const project = this._store.project;
    if (!project) return html``;
    const state = store.getFinalState();
    const scenes = state.fscenes;
    const stats = timesheetStats(scenes, state.fparsed.blocks.length);
    const estimate = stats.hasContent ? stats.estimate : 'unknown';
    return html`
      <div id="tsHead">
        <span class="lbl">Timesheet</span>
        <span id="tsStats">
          <b>${stats.pctBoarded}%</b> <span class="sb">boarded</span> ·
          <b>${stats.pctSourced}%</b> <span class="sr">sourced</span> ·
          est <b>${estimate}</b>${project.targetMins ? html` of ${project.targetMins}:00 target` : ''}
        </span>
      </div>
      <div id="tsStrip">
        ${scenes.map((sc) => html`
          <div class="seg" style="flex-grow:${Math.max(0.001, sc.secs)}"
            title="${(sc.pre ? 'Opening' : 'Sc ' + sc.label)} · ${sc.name} · ~${fmtT(sc.secs)} · ${sc.nb} board${sc.nb === 1 ? '' : 's'} · ${sc.nr} source${sc.nr === 1 ? '' : 's'}"
            @click=${(e) => this.#jump(sc, e.currentTarget)}
          >
            <span class="num">${sc.label}</span>
            <div class="lane b"><div class="fill" style="width:${(sc.fb * 100).toFixed(1)}%"></div></div>
            <div class="lane r"><div class="fill" style="width:${(sc.fr * 100).toFixed(1)}%"></div></div>
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define('pandemonium-timesheet', PandemoniumTimesheet);

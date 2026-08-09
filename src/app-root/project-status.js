'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { timelineStats, scriptProgress } from '../state/selectors.js';
import { CONTENT_TYPES } from '../fountain/blocks.js';
import { panelStyles } from '../styles/shared.js';
import '../components/ui/panel-picker.js';

// Project Status: the "how much" overview that moved off the timeline (which is
// now the "where"). Boarded / sourced / scripted at a glance, running time
// against the goal, and the writing goal itself. All figures come from the same
// honest selectors the timeline uses (hard rule 3): boarded/sourced exclude
// blank boards, scripted is counted by scene, and an empty draft reads
// "unknown" rather than a fabricated number.
export class PandemoniumProjectStatus extends LitElement {
  static properties = { leafId: {} };

  static styles = [panelStyles, css`
    .pbody{overflow:auto;padding:10px 10px 24px;display:flex;flex-direction:column;gap:18px}
    .stats{display:flex;gap:10px;flex-wrap:wrap}
    .stat{flex:1;min-width:92px;background:var(--panel);padding:12px 14px}
    .stat .n{font-size:26px;font-weight:600;line-height:1;color:var(--ink)}
    .stat .k{margin-top:6px;font-size:11px;color:var(--mut)}
    .stat.b .n{color:var(--board-ink)}
    .stat.r .n{color:var(--res)}
    .section{display:flex;flex-direction:column;gap:8px}
    .h{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    .bar{height:8px;background:var(--ph);overflow:hidden}
    .bar i{display:block;height:100%;background:var(--act)}
    .row{display:flex;justify-content:space-between;font-size:12px;color:var(--ui)}
    .row b{font-weight:500;color:var(--ink)}
    .goal{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ui)}
    .goal input{
      width:64px;height:26px;padding:0 8px;border:1px solid var(--btn-line);border-radius:var(--r);
      background:var(--field,var(--bg));color:var(--ink);font-family:var(--sans);font-size:12px;
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #setGoal(e) {
    const m = Math.max(0, parseInt(e.target.value, 10) || 0);
    this._store.store.updateProjectMeta({ targetMins: m });
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const state = this._store.store.getFinalState();
    const scenes = state.fscenes;
    const stats = timelineStats(scenes, state.fparsed.blocks.length);
    const prog = scriptProgress(scenes);
    const words = state.fparsed.blocks.reduce((a, b) => a + (CONTENT_TYPES[b.type] ? (b.words || 0) : 0), 0);
    const targetSecs = (project.targetMins || 0) * 60;
    const pctOfTarget = targetSecs ? Math.min(100, Math.round((100 * stats.totalSeconds) / targetSecs)) : 0;

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          <pd-panel-picker current="status" .leafId=${this.leafId}></pd-panel-picker>
        </div>
        <div class="pbody">
          <div class="stats">
            <div class="stat"><div class="n">${prog.pctScripted}%</div><div class="k">Scripted</div></div>
            <div class="stat b"><div class="n">${stats.pctBoarded}%</div><div class="k">Boarded</div></div>
            <div class="stat r"><div class="n">${stats.pctSourced}%</div><div class="k">Sourced</div></div>
          </div>

          <div class="section">
            <div class="h">Duration</div>
            <div class="row"><span>Estimated</span><span><b>~${stats.hasContent ? stats.estimate : 'unknown'}</b>${project.targetMins ? ' of ' + project.targetMins + ':00' : ''}</span></div>
            ${project.targetMins ? html`<div class="bar"><i style="width:${pctOfTarget}%"></i></div>` : ''}
          </div>

          <div class="section">
            <div class="h">Script</div>
            <div class="row"><span>Scenes written</span><span><b>${prog.scripted}</b> of ${prog.scenes}</span></div>
            <div class="row"><span>Still to write</span><span>${prog.planned}</span></div>
            <div class="row"><span>Words</span><span>${words.toLocaleString()}</span></div>
          </div>

          <div class="section">
            <div class="h">Writing goal</div>
            <div class="goal">
              <label>Target runtime</label>
              <input type="number" min="0" .value=${String(project.targetMins || 0)} @change=${(e) => this.#setGoal(e)}>
              <span>minutes</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-project-status', PandemoniumProjectStatus);

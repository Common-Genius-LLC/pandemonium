'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { getParsed } from '../../fountain/cache.js';
import { CONTENT_TYPES, scenesOf } from '../../fountain/blocks.js';
import { fmtT } from '../../utils/format.js';
import { panelStyles, tabStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import '../../app-root/draft-chip.js';
import './script-editor.js';

// Panel chrome only: header, draft tabs, word count. All editing and
// selection/linking behavior lives in <pandemonium-script-editor> (see
// script-editor.js). The per-line element type is set from the row hover rail
// now (cm-sections), so there is no top-right element switcher here.
export class PandemoniumScriptPanel extends LitElement {
  static properties = { leafId: {} };

  static styles = [panelStyles, tabStyles, css`
    /* The working area is the final draft's blue only while the final draft is
       the one open, matching the design's two variants: the draft that owns
       the storyboard and research links is the one that looks different. */
    .pbody{position:relative;display:flex;flex-direction:column}
    /* The one panel that keeps the chrome grey: its tabs are cut out of it. */
    .chrome{background:var(--chrome-panel)}
    /* Word count floats at the working area's top right. */
    .wc{position:absolute;top:6px;right:10px;z-index:2;color:var(--mut);font-size:10px;white-space:nowrap;pointer-events:none}
    .addtab{
      flex:none;height:30px;width:26px;font-size:15px;color:var(--mut);
      background:transparent;border:0;border-radius:0;cursor:pointer;font-family:var(--sans);
    }
    .addtab:hover{color:var(--ui)}
    pandemonium-script-editor{flex:1;min-height:0}
    @media (max-width:760px){
      .wc{font-size:9px}
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #title() {
    return html`<pd-panel-picker current="script" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  #addScript() {
    const store = this._store.store;
    const script = store.createScript({});
    // Show the new draft in this pane only (per-pane draft, see scriptForLeaf).
    store.setPaneDraft(this.leafId, script.id);
    dispatch(this, 'pandemonium-toast', { message: 'New draft created. Start writing in Fountain.' });
  }

  render() {
    const store = this._store.store;
    const project = this._store.project;
    if (!project) return html``;
    const sc = store.scriptForLeaf(this.leafId);
    const parsed = getParsed(sc);

    const words = parsed.blocks.reduce((a, b) => a + (CONTENT_TYPES[b.type] ? b.words : 0), 0);
    const secs = scenesOf(parsed).reduce((a, s) => a + s.secs, 0);
    const wc = words ? words.toLocaleString() + ' w · est ' + fmtT(secs) : '';

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          ${this.#title()}
          <div class="tabs">
            ${project.scripts.map((s) => html`<pandemonium-draft-chip .script=${s} .leafId=${this.leafId}></pandemonium-draft-chip>`)}
            <button class="addtab" title="Add a new draft" @click=${() => this.#addScript()}>+</button>
          </div>
        </div>
        <div class="pbody">
          <span class="wc">${wc}</span>
          <pandemonium-script-editor .leafId=${this.leafId}></pandemonium-script-editor>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-script-panel', PandemoniumScriptPanel);

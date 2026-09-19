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

const EDITOR_TAG = 'pandemonium-script-editor';

// Panel chrome only: header, draft tabs, word count. All editing and
// selection/linking behavior lives in <pandemonium-script-editor> (see
// script-editor.js), loaded on demand rather than imported here at module
// scope: it pulls in CodeMirror, and the default layout (layout-tree.js)
// has no script leaf at all, so most sessions never need it. Same lazy
// pattern as the beta bug-report dialog in pandemonium-app.js. The per-line
// element type is set from the row hover rail now (cm-sections), so there
// is no top-right element switcher here.
export class PandemoniumScriptPanel extends LitElement {
  static properties = { leafId: {}, _editorReady: { state: true } };

  static styles = [panelStyles, tabStyles, css`
    /* The working area is the final draft's blue only while the final draft is
       the one open, matching the design's two variants: the draft that owns
       the storyboard and research links is the one that looks different. */
    .pbody{position:relative;display:flex;flex-direction:column}
    /* The chrome takes the pane's own fill like every other panel's does; the
       rule stays only for the padding. The whole pane is one surface now,
       strip and desk alike, so the script panel matches the others instead of
       being the one that is grey. Inactive tabs keep --chrome-panel and so
       still read as sitting behind it, which is what the cut-out needs. No
       bottom padding: the active tab must reach the pbody with no gap so it
       reads as one continuous surface with the working area. */
    .chrome{padding-bottom:0}
    /* Word count floats at the working area's top right. */
    .wc{position:absolute;top:6px;right:10px;z-index:2;color:var(--mut);font-size:10px;white-space:nowrap;pointer-events:none}
    .addtab{
      flex:none;height:30px;width:26px;font-size:15px;color:var(--mut);
      background:transparent;border:0;border-radius:0;cursor:pointer;font-family:var(--sans);
    }
    .addtab:hover{color:var(--ui)}
    pandemonium-script-editor{flex:1;min-height:0}
    .loading{flex:1;min-height:0}
    @media (max-width:760px){
      .wc{font-size:9px}
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    // A second script pane opened after the first already resolved this import
    // (module imports are cached, so the second call is free either way) skips
    // the loading placeholder entirely instead of flashing it needlessly.
    this._editorReady = !!customElements.get(EDITOR_TAG);
    if (!this._editorReady) import('./script-editor.js').then(() => { this._editorReady = true; });
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

  // Focused writing: show only this pane, full width, without touching the
  // saved split tree (panel-layout.js reads ui.focusedLeaf to short-circuit
  // its render). Toggling it again, from anywhere -- this pane is the only
  // one on screen while focused -- restores the normal layout.
  #toggleFocus() {
    const store = this._store.store;
    const focused = store.ui.focusedLeaf === this.leafId;
    store.setUI({ focusedLeaf: focused ? null : this.leafId });
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
    const focused = this._store.ui && this._store.ui.focusedLeaf === this.leafId;

    return html`
      <div class="shell" style="--pane-bg:var(--bg)">
        <div class="chrome">
          ${this.#title()}
          <div class="tabs" data-clarity-mask="true">
            ${project.scripts.map((s) => html`<pandemonium-draft-chip .script=${s} .leafId=${this.leafId}></pandemonium-draft-chip>`)}
            <button class="addtab" title="Add a new draft" @click=${() => this.#addScript()}>+</button>
          </div>
          <div class="tools">
            <pd-button title=${focused ? 'Exit focused writing' : 'Focused writing: hide every other pane'} @click=${() => this.#toggleFocus()}>${focused ? 'Exit focus' : 'Focus'}</pd-button>
          </div>
        </div>
        <div class="pbody" data-clarity-mask="true">
          <span class="wc">${wc}</span>
          ${this._editorReady
            ? html`<pandemonium-script-editor .leafId=${this.leafId}></pandemonium-script-editor>`
            : html`<div class="loading"></div>`}
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-script-panel', PandemoniumScriptPanel);

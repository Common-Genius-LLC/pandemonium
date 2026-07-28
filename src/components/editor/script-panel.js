'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { getParsed } from '../../fountain/cache.js';
import { CONTENT_TYPES, scenesOf } from '../../fountain/blocks.js';
import { fmtT } from '../../utils/format.js';
import { ELEMENT_LABELS, ELEMENT_MENU } from '../../fountain/element-ops.js';
import { panelStyles, tabStyles } from '../../styles/shared.js';
import { dropdownStyles, dropdownCaret } from '../ui/dropdown.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import '../../app-root/draft-chip.js';
import './script-editor.js';

// Panel chrome only: header, word count, the non-final-draft banner. All
// editing and selection/linking behavior lives in <pandemonium-script-editor>
// (see script-editor.js) -- there is no Preview/Edit mode here anymore, so
// there is nothing for a user to be "stuck in" that has no linking support.
export class PandemoniumScriptPanel extends LitElement {
  static properties = { leafId: {}, _elt: { state: true } };

  static styles = [panelStyles, dropdownStyles, tabStyles, css`
    /* The working area is the final draft's blue only while the final draft is
       the one open, matching the design's two variants: the draft that owns
       the storyboard and research links is the one that looks different. */
    .pbody{position:relative;display:flex;flex-direction:column}
    /* The one panel that keeps the chrome grey: its tabs are cut out of it. */
    .chrome{background:var(--chrome-panel)}
    #draftBanner{
      flex:none;background:var(--warn);color:var(--ink);padding:7px 12px;
      display:flex;align-items:center;gap:10px;font-size:11px;
    }
    /* The element picker floats at the working area's top right, where the
       design puts it: inside the page, near the line it describes. */
    .eltbar{
      position:absolute;top:5px;right:6px;z-index:2;
      display:flex;align-items:center;gap:8px;
    }
    .wc{color:var(--mut);font-size:10px;white-space:nowrap}
    .addtab{
      flex:none;height:30px;width:26px;font-size:15px;color:var(--mut);
      background:transparent;border:0;border-radius:0;cursor:pointer;font-family:var(--sans);
    }
    .addtab:hover{color:var(--ui)}
    pandemonium-script-editor{flex:1;min-height:0}
    @media (max-width:760px){
      .eltbar{
        position:static;
        justify-content:flex-end;
        flex-wrap:wrap;
        padding:6px 8px 0;
      }
      .wc{font-size:9px}
    }
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._elt = 'action';
  }

  // The editor reports the element under its caret; the picker shows/tracks it.
  #onCaretElement = (e) => { this._elt = e.detail.key; };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pandemonium-caret-element', this.#onCaretElement);
  }

  disconnectedCallback() {
    this.removeEventListener('pandemonium-caret-element', this.#onCaretElement);
    super.disconnectedCallback();
  }

  #elementMenu(e) {
    const cur = this._elt;
    const items = ELEMENT_MENU.map((k) => ({
      label: ELEMENT_LABELS[k],
      selected: k === cur,
      fn: () => { const ed = this.renderRoot.querySelector('pandemonium-script-editor'); if (ed) ed.setLineElement(k); },
    }));
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  #title() {
    return html`<pd-panel-picker current="script" .leafId=${this.leafId}></pd-panel-picker>`;
  }

  #addScript() {
    const store = this._store.store;
    const script = store.createScript({});
    store.setUI({ draftId: script.id });
    dispatch(this, 'pandemonium-toast', { message: 'New draft created. Start writing in Fountain.' });
  }

  render() {
    const store = this._store.store;
    const project = this._store.project;
    if (!project) return html``;
    const sc = store.activeScript();
    const parsed = getParsed(sc);
    const finalScript = store.finalScript();

    const words = parsed.blocks.reduce((a, b) => a + (CONTENT_TYPES[b.type] ? b.words : 0), 0);
    const secs = scenesOf(parsed).reduce((a, s) => a + s.secs, 0);
    const wc = words ? words.toLocaleString() + ' w · est ' + fmtT(secs) : '';

    return html`
      <div class="shell" style="--pane-bg:${sc.final ? 'var(--pane-script)' : '#fff'}">
        <div class="chrome">
          ${this.#title()}
          <div class="tabs">
            ${project.scripts.map((s) => html`<pandemonium-draft-chip .script=${s}></pandemonium-draft-chip>`)}
            <button class="addtab" title="Add a new draft" @click=${() => this.#addScript()}>+</button>
          </div>
        </div>
        <div class="pbody">
          <div class="eltbar">
            <span class="wc">${wc}</span>
            <button class="pd-dropdown" title="Set the current line's screenplay element" @click=${(e) => this.#elementMenu(e)}
              >${ELEMENT_LABELS[this._elt] || 'Action'}${dropdownCaret}</button>
          </div>
          ${!sc.final ? html`
            <div id="draftBanner">
              <span>Boards &amp; sources attach to the final draft, <b>${finalScript.name}</b>.</span>
              <pd-button @click=${() => store.makeFinal(sc.id)}>Make this final</pd-button>
              <pd-button @click=${() => store.setUI({ draftId: finalScript.id })}>View final</pd-button>
            </div>` : nothing}
          <pandemonium-script-editor></pandemonium-script-editor>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-script-panel', PandemoniumScriptPanel);

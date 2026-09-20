'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { getParsed } from '../../fountain/cache.js';
import { CONTENT_TYPES, scenesOf } from '../../fountain/blocks.js';
import { fmtT } from '../../utils/format.js';
import { panelStyles } from '../../styles/shared.js';
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

  static styles = [panelStyles, css`
    /* The working area is the final draft's blue only while the final draft is
       the one open, matching the design's two variants: the draft that owns
       the storyboard and reference links is the one that looks different. */
    .pbody{position:relative;display:flex;flex-direction:column}
    /* The drafts: pills in a pill track, the same object as the storyboard
       Final / Reference switch. One dark pill (.thumb) sits behind the row and
       slides to whichever draft is active, so switching drafts is one motion
       the eye can follow. The track scrolls sideways when there are more
       drafts than fit, and the thumb scrolls with it. */
    .tabs{
      position:relative;display:flex;align-items:center;gap:2px;margin-left:10px;
      align-self:center;min-width:0;max-width:100%;padding:3px;border-radius:20px;
      background:var(--panel);overflow-x:auto;scrollbar-width:none;
    }
    .tabs::-webkit-scrollbar{display:none}
    .thumb{
      position:absolute;top:3px;left:0;height:24px;width:0;border-radius:20px;
      background:var(--overlay);pointer-events:none;z-index:0;opacity:0;
      transition:transform var(--dur-2) var(--ease-in-out),width var(--dur-2) var(--ease-in-out),opacity var(--dur-1) linear;
    }
    .thumb.still{transition:none}
    /* Word count floats at the working area's top left: the right edge
       belongs to the minimap. */
    .wc{position:absolute;top:8px;left:14px;z-index:2;color:var(--mut);font-size:10px;white-space:nowrap;pointer-events:none}
    /* Outside the track on purpose: the track scrolls when the drafts
       overflow it, and a button inside would scroll out of sight with them.
       Here it always sits right after the last visible pill. */
    .addtab{
      flex:none;align-self:center;width:28px;height:28px;margin-left:4px;padding:0;border:0;border-radius:50%;
      font-size:16px;line-height:28px;color:var(--ui);background:var(--panel);cursor:pointer;font-family:var(--sans);
      transition:background var(--dur-1) var(--ease-out),color var(--dur-1) var(--ease-out);
    }
    .addtab:hover{color:var(--overlay-ink);background:var(--overlay)}
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

  // Moves the thumb under the active draft's pill. It waits for the chips to
  // finish their own render (each decides whether it is active in its own
  // update, after this panel's), and it does not animate the very first
  // placement, so a pane opens with the pill already in place rather than
  // sliding in from the left edge.
  async #placeThumb() {
    const thumb = this.renderRoot.querySelector('.thumb');
    if (!thumb) return;
    const chips = [...this.renderRoot.querySelectorAll('pandemonium-draft-chip')];
    await Promise.all(chips.map((c) => c.updateComplete));
    const id = this._store.store.scriptForLeaf(this.leafId).id;
    const chip = chips.find((c) => c.getAttribute('data-script-id') === id);
    if (!chip) { thumb.style.opacity = '0'; return; }
    thumb.style.transform = `translateX(${chip.offsetLeft}px)`;
    thumb.style.width = chip.offsetWidth + 'px';
    thumb.style.opacity = '1';
    if (thumb.classList.contains('still')) requestAnimationFrame(() => thumb.classList.remove('still'));
    // Keep the active pill in view when the drafts overflow the strip.
    const track = thumb.parentElement;
    if (chip.offsetLeft < track.scrollLeft || chip.offsetLeft + chip.offsetWidth > track.scrollLeft + track.clientWidth) {
      track.scrollTo({ left: chip.offsetLeft - 12, behavior: 'smooth' });
    }
  }

  updated() {
    this.#placeThumb();
  }

  firstUpdated() {
    // A draft renamed to something longer changes its pill's width without
    // this panel re-rendering; follow the track's size instead.
    const track = this.renderRoot.querySelector('.tabs');
    if (track && typeof ResizeObserver === 'function') {
      this._tabsObserver = new ResizeObserver(() => this.#placeThumb());
      this._tabsObserver.observe(track);
    }
  }

  disconnectedCallback() {
    if (this._tabsObserver) this._tabsObserver.disconnect();
    super.disconnectedCallback();
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
            <span class="thumb still" aria-hidden="true"></span>
            ${project.scripts.map((s) => html`<pandemonium-draft-chip .script=${s} .leafId=${this.leafId}></pandemonium-draft-chip>`)}
          </div>
          <button class="addtab" title="Add a new draft" aria-label="Add a new draft" @click=${() => this.#addScript()}>+</button>
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

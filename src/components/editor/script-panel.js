'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { getParsed } from '../../fountain/cache.js';
import { CONTENT_TYPES, scenesOf } from '../../fountain/blocks.js';
import { fmtT } from '../../utils/format.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './script-editor.js';

// Panel chrome only: header, word count, the non-final-draft banner. All
// editing and selection/linking behavior lives in <pandemonium-script-editor>
// (see script-editor.js) -- there is no Preview/Edit mode here anymore, so
// there is nothing for a user to be "stuck in" that has no linking support.
export class PandemoniumScriptPanel extends LitElement {
  static properties = { slotId: {} };

  static styles = [panelStyles, css`
    #draftBanner{
      flex:none;background:var(--warn);color:var(--ink);padding:7px 12px;border-radius:var(--r);
      margin-bottom:8px;display:flex;align-items:center;gap:10px;font-size:11px;
    }
    .wc{color:var(--mut);font-size:10px;white-space:nowrap}
    pandemonium-script-editor{flex:1;min-height:0}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #title() {
    if (this._store.ui.view === 'split') return html`<span class="lbl">Script</span>`;
    return html`<pd-panel-picker current="script" .slotId=${this.slotId ?? 1}></pd-panel-picker>`;
  }

  #addScript() {
    const store = this._store.store;
    const script = store.createScript({});
    store.setUI({ draftId: script.id });
    dispatch(this, 'pandemonium-toast', { message: 'New draft created. Start writing in Fountain.' });
  }

  // Draft management now lives with the script it acts on (notes.md point g).
  // The Delete item here is what makes deleting a draft discoverable (point 2):
  // it used to be reachable only by clicking the already-active draft chip.
  #draftMenu(e) {
    const store = this._store.store;
    const sc = store.activeScript();
    const project = this._store.project;
    const items = [
      { label: 'Rename draft', fn: () => this.#rename(sc) },
      { label: 'Duplicate draft', fn: () => store.duplicateScript(sc.id) },
    ];
    if (!sc.final) items.push({ label: 'Make final draft', fn: () => store.makeFinal(sc.id) });
    if (project.scripts.length > 1) items.push({ label: 'Delete draft', danger: true, fn: () => this.#delete(sc) });
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  #rename(sc) {
    dispatch(this, 'pandemonium-open-dialog', {
      title: 'Rename draft',
      okLabel: 'Rename',
      body: html`<div class="field"><label class="lbl">Name</label><input type="text" id="f_name" .value=${sc.name}></div>`,
      onOk: (root) => { const v = root.querySelector('#f_name').value.trim(); if (v) this._store.store.renameScript(sc.id, v); },
    });
  }

  #delete(sc) {
    const extra = sc.final ? ' It is the final draft, so another draft will become final.' : '';
    if (!confirm('Delete draft "' + sc.name + '"?' + extra)) return;
    this._store.store.deleteScript(sc.id);
    dispatch(this, 'pandemonium-toast', { message: 'Draft deleted.' });
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
      <div class="phead">
        ${this.#title()}<span class="sub">${sc.name}${sc.final ? ' · final draft' : ''}</span>
        <div class="tools">
          <span class="wc">${wc}</span>
          <pd-button @click=${() => this.#addScript()} title="Create a new draft">+ Add script</pd-button>
          <pd-button variant="ghost" @click=${(e) => this.#draftMenu(e)} title="Rename, duplicate, make final, or delete this draft">Draft ▾</pd-button>
        </div>
      </div>
      ${!sc.final ? html`
        <div id="draftBanner">
          <span>Boards &amp; sources attach to the final draft, <b>${finalScript.name}</b>.</span>
          <pd-button @click=${() => store.makeFinal(sc.id)}>Make this final</pd-button>
          <pd-button @click=${() => store.setUI({ draftId: finalScript.id })}>View final</pd-button>
        </div>` : nothing}
      <pandemonium-script-editor></pandemonium-script-editor>
    `;
  }
}

customElements.define('pandemonium-script-panel', PandemoniumScriptPanel);

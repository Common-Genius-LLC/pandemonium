'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { formStyles, chipStyles } from '../styles/shared.js';
import '../components/ui/logo.js';
import '../components/ui/button.js';

// Phase 1: search is still the click-to-open command-palette button from the
// original. Phase 2 replaces it with a real inline field per the Figma
// re-skin decision (see project notes) without touching any other part of
// the topbar.
export class PandemoniumTopbar extends LitElement {
  static properties = {};

  static styles = [formStyles, chipStyles, css`
    :host{height:48px;flex:none;display:flex;align-items:center;gap:16px;padding:0 22px}
    #brand{display:flex;align-items:baseline;gap:10px;min-width:0}
    pd-logo{font-size:15px;color:var(--ink)}
    #projName{
      font-size:12px;color:var(--mut);background:none;border:0;padding:2px 4px;
      max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    #projName:hover{background:var(--panel)}
    #searchBox{flex:1;display:flex;justify-content:center}
    #searchBtn{
      width:min(320px,100%);height:28px;background:var(--panel);color:var(--mut);
      display:flex;align-items:center;gap:8px;padding:0 10px;font-size:12px;
      border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    #searchBtn .k{margin-left:auto;font-size:10px;color:var(--mut)}
    #viewTabs{display:flex;align-items:center;gap:4px}
    #viewTabs button{
      height:24px;padding:0 10px;color:var(--mut);font-size:11px;font-weight:500;
      background:none;border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    #viewTabs button:hover{color:var(--ui)}
    #viewTabs button.on{background:var(--ui);color:#fff}
    @media (max-width:900px){:host{gap:8px;padding:0 14px}#projName{display:none}}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #setView(view) {
    this._store.store.setUI({ view, pair: null });
  }

  #openSettings() {
    dispatch(this, 'pandemonium-open-project-settings', {});
  }

  #openSearch() {
    this._store.store.setUI({ searchOpen: true });
  }

  render() {
    const project = this._store.project;
    const ui = this._store.ui;
    if (!project) return html``;
    const isMac = /mac/i.test(navigator.platform || '');
    return html`
      <div id="brand">
        <pd-logo></pd-logo>
        <button id="projName" title="Project settings" @click=${() => this.#openSettings()}>${project.name || 'Untitled'}</button>
      </div>
      <div id="searchBox">
        <button id="searchBtn" @click=${() => this.#openSearch()}>
          <span>Search</span><span style="opacity:.55">Everything</span>
          <span class="k">${isMac ? '⌘K' : 'Ctrl K'}</span>
        </button>
      </div>
      <div id="viewTabs">
        <button class=${ui.view === 'split' ? 'on' : ''} @click=${() => this.#setView('split')}>Split View</button>
        <button class=${ui.view === 'everything' ? 'on' : ''} @click=${() => this.#setView('everything')}>Everything</button>
        <button class=${ui.view === 'single' ? 'on' : ''} @click=${() => this.#setView('single')}>Single View</button>
      </div>
    `;
  }
}

customElements.define('pandemonium-topbar', PandemoniumTopbar);

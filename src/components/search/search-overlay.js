'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { getParsed } from '../../fountain/cache.js';
import { docParas } from '../../data/research-doc.js';
import { esc } from '../../utils/format.js';
import { formStyles } from '../../styles/shared.js';

// Full-text search across scripts, research, and boards. Phase 1 keeps this
// as the original's full-screen modal, opened from the topbar search field
// or Ctrl/Cmd-K; Phase 2's search re-skin changes how it's triggered, not
// this component's search/results logic.
export class PandemoniumSearchOverlay extends LitElement {
  static styles = [formStyles, css`
    :host{position:fixed;inset:0;z-index:80;display:none}
    :host([data-open]){display:flex}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;justify-content:center;align-items:flex-start;padding-top:9vh}
    .panel{width:min(600px,92vw);background:var(--bg);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;max-height:70vh}
    input{height:44px;padding:0 16px;font-size:14px;background:var(--bg);border-radius:0;width:100%}
    .meta{padding:0 16px 8px;color:var(--mut);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
    .res{overflow:auto;padding:0 6px 8px;scrollbar-width:thin;scrollbar-color:var(--ph) transparent}
    .grp{padding:10px 10px 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    .sres{display:flex;flex-direction:column;gap:1px;padding:7px 10px;border-radius:var(--r);cursor:pointer}
    .sres:hover,.sres.on{background:var(--panel)}
    .l1{color:var(--ink);display:flex;gap:8px;align-items:baseline;min-width:0}
    .l1 .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .l1 b{background:var(--act);font-weight:500;border-radius:1px}
    .l2{color:var(--mut);font-size:10px}
    .empty{color:var(--mut);padding:14px 16px}
  `];

  static properties = { _results: { state: true }, _idx: { state: true }, _query: { state: true } };

  constructor() {
    super();
    this._store = new StoreController(this);
    this._results = [];
    this._idx = 0;
    this._query = '';
  }

  #close() {
    this._store.store.setUI({ searchOpen: false });
  }

  #hiSnip(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text.slice(0, 120));
    const a = Math.max(0, i - 40);
    return (a > 0 ? '... ' : '') + esc(text.slice(a, i)) + '<b>' + esc(text.slice(i, i + q.length)) + '</b>' + esc(text.slice(i + q.length, i + q.length + 90));
  }

  #run(raw) {
    const project = this._store.project;
    this._query = raw;
    const q = raw.trim().toLowerCase();
    const results = [];
    if (q && project) {
      outer:
      for (const s of project.scripts) {
        const parsed = getParsed(s);
        for (const b of parsed.blocks) {
          if (!b.plain || !b.plain.toLowerCase().includes(q)) continue;
          results.push({ group: 'Scripts', t: b.plain, sub: s.name + (s.final ? ' · final' : '') + ' · ' + b.type, go: { k: 'script', sid: s.id, bi: b.i } });
          if (results.filter((r) => r.group === 'Scripts').length >= 8) break outer;
        }
      }
      let researchCount = 0;
      for (const d of project.research) {
        if (researchCount >= 8) break;
        if ((d.title || '').toLowerCase().includes(q)) { results.push({ group: 'Research', t: d.title || 'Untitled', sub: d.kind, go: { k: 'doc', id: d.id } }); researchCount++; }
        docParas(d).forEach((p, pi) => {
          if (researchCount < 8 && p.toLowerCase().includes(q)) { results.push({ group: 'Research', t: p, sub: d.title || 'Untitled', go: { k: 'doc', id: d.id, pi } }); researchCount++; }
        });
      }
      let boardCount = 0;
      for (const bd of project.boards) {
        if (boardCount >= 8) break;
        const cap = bd.caption || '';
        const qq = (bd.anchor.parts[0] && bd.anchor.parts[0].q) || '';
        if (cap.toLowerCase().includes(q) || qq.toLowerCase().includes(q)) { results.push({ group: 'Boards', t: cap || qq, sub: 'storyboard', go: { k: 'board', id: bd.id } }); boardCount++; }
      }
    }
    this._results = results.map((r) => ({ ...r, q }));
    this._idx = 0;
  }

  #move(d) {
    if (!this._results.length) return;
    this._idx = (this._idx + d + this._results.length) % this._results.length;
    this.updateComplete.then(() => {
      const el = this.renderRoot.querySelectorAll('.sres')[this._idx];
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  #go(r) {
    if (!r) return;
    const store = this._store.store;
    this.#close();
    store.setUI({ pair: null });
    const g = r.go;
    if (g.k === 'script') {
      store.setUI({ draftId: g.sid, scrollToBlock: g.bi });
    } else if (g.k === 'doc') {
      const patch = { openDoc: g.id, readerEdit: false };
      if (store.ui.view === 'single') patch.view = 'split';
      if ((patch.view || store.ui.view) === 'split') patch.split = 'research';
      if (typeof g.pi === 'number') patch.scrollToParagraph = g.pi;
      store.setUI(patch);
    } else if (g.k === 'board') {
      const patch = { highlightBoard: g.id };
      if (store.ui.view === 'single') { patch.view = 'split'; patch.split = 'boards'; }
      else if (store.ui.view === 'split') patch.split = 'boards';
      store.setUI(patch);
    }
  }

  updated() {
    const ui = this._store.ui;
    const isOpen = !!(ui && ui.searchOpen);
    this.toggleAttribute('data-open', isOpen);
    if (isOpen && !this._wasOpen) {
      this._results = [];
      this._idx = 0;
      this._query = '';
      this.updateComplete.then(() => {
        const inp = this.renderRoot.querySelector('input');
        if (inp) { inp.value = ''; inp.focus(); }
      });
    }
    this._wasOpen = isOpen;
  }

  #onKeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.#move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.#move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this.#go(this._results[this._idx]); }
    else if (e.key === 'Escape') { this.#close(); }
  }

  render() {
    const groups = ['Scripts', 'Research', 'Boards'];
    return html`
      <div class="ov" @mousedown=${(e) => { if (e.target === e.currentTarget) this.#close(); }}>
        <div class="panel">
          <input type="text" placeholder="Search everything" autocomplete="off" @input=${(e) => this.#run(e.target.value)} @keydown=${(e) => this.#onKeydown(e)}>
          <div class="meta">Scripts · Research · Boards</div>
          <div class="res">
            ${groups.map((g) => {
              const items = this._results.filter((r) => r.group === g);
              if (!items.length) return nothing;
              return html`
                <div class="grp">${g}</div>
                ${items.map((r) => {
                  const ix = this._results.indexOf(r);
                  return html`
                    <div class="sres ${ix === this._idx ? 'on' : ''}" @click=${() => this.#go(r)} @mousemove=${() => { this._idx = ix; }}>
                      <div class="l1"><span class="t" .innerHTML=${this.#hiSnip(r.t, r.q)}></span></div>
                      <div class="l2">${r.sub}</div>
                    </div>
                  `;
                })}
              `;
            })}
            ${this._results.length === 0 && this._query.trim()
              ? html`<div class="empty">Nothing found.</div>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pandemonium-search-overlay', PandemoniumSearchOverlay);

'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { getParsed } from '../../fountain/cache.js';
import { docParas } from '../../data/research-doc.js';
import { esc } from '../../utils/format.js';

// Search across scripts, research and boards, as a real field in the title bar
// with its results directly under it. It used to be a button that opened a
// full-screen modal, which meant the search box on screen was not the search
// box you typed into. Now there is one field: click it and type.
//
// Results are computed on every keystroke against the in-memory project, which
// is small enough (one screenplay plus notes) that this needs no index.
const CAP = 8;

export class PandemoniumSearchField extends LitElement {
  static properties = { _results: { state: true }, _idx: { state: true }, _query: { state: true }, _open: { state: true } };

  static styles = css`
    :host{position:relative;display:block;width:100%;font-family:var(--sans)}
    .field{
      position:relative;box-sizing:border-box;width:100%;height:28px;
      background:#fff;border-radius:1px;box-shadow:0 2px 4px rgba(0,0,0,.09);
      display:flex;align-items:center;padding:0 10px;overflow:hidden;
    }
    /* "Search Everything" is one placeholder in two weights, so it has to be
       drawn rather than set on the input, which can only carry one style.
       Both halves go the moment there is any text. */
    .ph{
      position:absolute;left:10px;top:50%;transform:translateY(-50%);
      display:flex;gap:3px;pointer-events:none;
      font-size:14px;line-height:16px;color:#000;white-space:nowrap;
    }
    .ph i{font-style:italic;color:var(--mut)}
    input{
      flex:1;min-width:0;font-family:inherit;font-size:14px;line-height:16px;
      color:#000;background:transparent;border:0;outline:none;padding:0;
    }

    .pop{
      position:absolute;left:0;right:0;top:32px;z-index:5;
      background:var(--bg);border-radius:var(--r);
      box-shadow:0 8px 24px rgba(0,0,0,.22);
      max-height:min(60vh,420px);overflow:auto;
      padding:4px 6px 8px;
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    .grp{padding:10px 10px 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    .sres{display:flex;flex-direction:column;gap:1px;padding:7px 10px;border-radius:var(--r);cursor:pointer}
    .sres:hover,.sres.on{background:var(--panel)}
    .l1{color:var(--ink);font-size:12px;display:flex;gap:8px;align-items:baseline;min-width:0}
    .l1 .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .l1 b{background:var(--act);font-weight:500;border-radius:1px}
    .l2{color:var(--mut);font-size:10px}
    .empty{color:var(--mut);padding:14px 10px;font-size:12px}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._results = [];
    this._idx = 0;
    this._query = '';
    this._open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Anywhere outside the field closes the results. composedPath is what
    // makes that work across the shadow boundary.
    this._onDocDown = (e) => { if (this._open && !e.composedPath().includes(this)) this._open = false; };
    document.addEventListener('mousedown', this._onDocDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown, true);
    super.disconnectedCallback();
  }

  // Ctrl/Cmd-K puts the caret here rather than opening anything.
  focusField() {
    const inp = this.renderRoot.querySelector('input');
    if (inp) { inp.focus(); inp.select(); }
    if (this._query.trim()) this._open = true;
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
          if (results.filter((r) => r.group === 'Scripts').length >= CAP) break outer;
        }
      }
      let researchCount = 0;
      for (const d of project.research) {
        if (researchCount >= CAP) break;
        if ((d.title || '').toLowerCase().includes(q)) { results.push({ group: 'Research', t: d.title || 'Untitled', sub: d.kind, go: { k: 'doc', id: d.id } }); researchCount++; }
        docParas(d).forEach((p, pi) => {
          if (researchCount < CAP && p.toLowerCase().includes(q)) { results.push({ group: 'Research', t: p, sub: d.title || 'Untitled', go: { k: 'doc', id: d.id, pi } }); researchCount++; }
        });
      }
      let boardCount = 0;
      for (const bd of project.boards) {
        if (boardCount >= CAP) break;
        const cap = bd.caption || '';
        const qq = (bd.anchor.parts[0] && bd.anchor.parts[0].q) || '';
        if (cap.toLowerCase().includes(q) || qq.toLowerCase().includes(q)) { results.push({ group: 'Boards', t: cap || qq, sub: 'storyboard', go: { k: 'board', id: bd.id } }); boardCount++; }
      }
    }
    this._results = results.map((r) => ({ ...r, q }));
    this._idx = 0;
    this._open = !!q;
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
    this._open = false;
    store.setUI({ pair: null });
    const g = r.go;
    if (g.k === 'script') {
      store.setUI({ draftId: g.sid, scrollToBlock: g.bi });
    } else if (g.k === 'doc') {
      const patch = { openDoc: g.id, readerEdit: false };
      if (typeof g.pi === 'number') patch.scrollToParagraph = g.pi;
      store.setUI(patch);
    } else if (g.k === 'board') {
      store.setUI({ highlightBoard: g.id });
    }
  }

  #onKeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this._open = true; this.#move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.#move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this.#go(this._results[this._idx]); }
    else if (e.key === 'Escape') { this._open = false; e.target.blur(); }
  }

  render() {
    const groups = ['Scripts', 'Research', 'Boards'];
    return html`
      <div class="field">
        ${this._query ? nothing : html`<span class="ph">Search <i>Everything</i></span>`}
        <input type="text" autocomplete="off" aria-label="Search everything"
          .value=${this._query}
          @input=${(e) => this.#run(e.target.value)}
          @focus=${() => { if (this._query.trim()) this._open = true; }}
          @keydown=${(e) => this.#onKeydown(e)}>
      </div>
      ${this._open ? html`
        <div class="pop">
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
        </div>` : nothing}
    `;
  }
}

customElements.define('pandemonium-search-field', PandemoniumSearchField);

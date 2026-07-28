'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { blockHTML } from '../../fountain/blocks.js';
import { resolvePart } from '../../fountain/resolve.js';
import { docParas, paraAsBlock } from '../../data/research-doc.js';
import { captureParts, getRootSelection } from '../../utils/selection.js';
import { clamp } from '../../utils/format.js';
import { openPair } from '../../state/actions.js';
import { formStyles } from '../../styles/shared.js';
import '../ui/button.js';

// The open-document view. Phase 1 keeps the original Read/Edit split (only
// Read mode supports select-to-link, same limitation the script panel has)
// -- Phase 3 unifies both into one CodeMirror surface the same way it does
// for the script.
export class PandemoniumResearchReader extends LitElement {
  static styles = [formStyles, css`
    :host{display:flex;flex-direction:column;min-height:0;height:100%}
    .rhead{flex:none;display:flex;align-items:center;gap:8px;padding-bottom:8px}
    .rtitle{
      font-size:13px;font-weight:500;color:var(--ink);background:transparent;padding:2px 4px;flex:1;min-width:0;
      border:0;border-radius:var(--r);font-family:var(--sans);height:auto;
    }
    .rtitle:hover,.rtitle:focus{background:var(--panel)}
    .rurl{flex:none;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--link)}
    .lost .btn-like{background:var(--warn)}
    #readerBody{
      flex:1;overflow:auto;line-height:1.7;font-size:12px;color:var(--ink);padding:2px 4px 30vh;
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    #readerBody p{margin-bottom:1em;white-space:pre-wrap}
    #readerBody mark.hr{background:var(--res);color:#fff;cursor:pointer;border-radius:1px}
    #readerBody mark.hp{background:var(--pend);border-radius:1px}
    #readerBody mark.pulse{animation:pulse 1s ease-in-out 2}
    @keyframes pulse{50%{filter:brightness(.82)}}
    #readerEdit{width:100%;height:100%;resize:none;background:var(--bg);padding:2px 4px;line-height:1.7;font-size:12px;display:block;border-radius:0}
    .empty{color:var(--mut);padding:18px 4px;line-height:1.7;max-width:340px}
    .mode{display:flex;gap:2px}
    .mode button{height:20px;padding:0 8px;font-size:10px;font-weight:500;color:var(--mut);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
    .mode button.on{background:var(--ui);color:#fff}
    @media (max-width:900px){
      .rhead{flex-wrap:wrap}
      .rtitle{order:2;flex-basis:100%}
      .rurl{order:3;flex-basis:100%;max-width:100%}
    }
  `];

  static properties = { doc: { type: Object } };

  #connRAF = 0;
  #lastPulsed = null;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#connRAF);
    super.disconnectedCallback();
  }

  #back() {
    this._store.store.setUI({ openDoc: null, readerEdit: false, pair: null });
  }

  #setMode(edit) {
    this._store.store.setUI({ readerEdit: edit });
  }

  #title(e) { this._store.store.updateResearchTitle(this.doc.id, e.target.value); }
  #body(e) { this._store.store.updateResearchBody(this.doc.id, e.target.value); }

  #delete() {
    const d = this.doc;
    if (!confirm('Delete "' + (d.title || 'Untitled') + '" and its links to the script?')) return;
    this._store.store.deleteResearch(d.id);
    dispatch(this, 'pandemonium-toast', { message: 'Source deleted.' });
  }

  #reattachLost(lostArr) {
    const store = this._store.store;
    const id = lostArr[0].lk.id;
    store.setUI({ pendingRelink: { type: 'link', id }, draftId: store.finalScript().id });
  }

  #onMouseUp() {
    setTimeout(() => {
      const store = this._store.store;
      const ui = store.ui;
      const body = this.renderRoot.getElementById('readerBody');
      if (!body) return;
      const parts = captureParts(body, 'data-ri', this.renderRoot);
      if (!parts) return;
      if (ui.linking && ui.linking.from === 'script') {
        store.addLink({ researchId: this.doc.id, sParts: ui.linking.parts, rParts: parts });
        store.setUI({ linking: null });
        getRootSelection(this.renderRoot).removeAllRanges();
        dispatch(this, 'pandemonium-toast', { message: 'Linked.' });
        return;
      }
      dispatch(this, 'pandemonium-show-selection-toolbar', { kind: 'research', parts, anchorRect: getRootSelection(this.renderRoot).getRangeAt(0).getBoundingClientRect() });
    }, 0);
  }

  #onClickMark(e) {
    const mk = e.target.closest('mark');
    if (!mk) return;
    const sel = getRootSelection(this.renderRoot);
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) return;
    const rTok = (mk.dataset.hl || '').split(/\s+/).find((t) => t.indexOf('r:') === 0);
    if (rTok) { openPair(this._store.store, rTok.slice(2)); e.stopPropagation(); }
  }

  updated() {
    const ui = this._store.ui;
    if (!ui) return;

    if (ui.scrollToParagraph != null) {
      const pi = ui.scrollToParagraph;
      this._store.store.setUI({ scrollToParagraph: null });
      requestAnimationFrame(() => {
        const p = this.renderRoot.querySelector(`[data-ri="${pi}"]`);
        if (!p) return;
        p.scrollIntoView({ block: 'center' });
        p.style.background = 'var(--act)';
        setTimeout(() => { p.style.background = ''; }, 900);
      });
    }

    cancelAnimationFrame(this.#connRAF);
    if (!ui.pair) { this.#lastPulsed = null; dispatch(this, 'pandemonium-connector-point', { side: 'research', rect: null }); return; }
    if (ui.pair !== this.#lastPulsed) {
      this.#lastPulsed = ui.pair;
      const mark = this.renderRoot.querySelector(`mark[data-hl~="r:${ui.pair}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        mark.classList.add('pulse');
        setTimeout(() => mark.classList.remove('pulse'), 2100);
      }
    }
    const tick = () => {
      const mark = this.renderRoot.querySelector(`mark[data-hl~="r:${ui.pair}"]`);
      let rect = null;
      if (mark) {
        const r = mark.getBoundingClientRect();
        rect = { x: clamp(r.left + Math.min(r.width, 60) / 2, 6, innerWidth - 6), y: clamp(r.top + r.height / 2, 6, innerHeight - 6) };
      } else {
        const titleEl = this.renderRoot.querySelector('.rtitle');
        if (titleEl) { const r = titleEl.getBoundingClientRect(); rect = { x: r.left + 10, y: r.top + r.height / 2 }; }
      }
      dispatch(this, 'pandemonium-connector-point', { side: 'research', rect });
      this.#connRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  render() {
    const doc = this.doc;
    const ui = this._store.ui;
    const store = this._store.store;
    const finalState = store.getFinalState();
    const lostArr = finalState.R.links.filter((o) => o.lk.researchId === doc.id && !o.ok);

    let bodyContent;
    if (ui.readerEdit) {
      bodyContent = html`<textarea id="readerEdit" spellcheck="false" .value=${doc.body || ''} @input=${(e) => this.#body(e)}></textarea>`;
    } else {
      const paras = docParas(doc);
      const map = {};
      const add = (r, cls, id, kind) => { if (!r) return; (map[r.bi] = map[r.bi] || []).push({ s: r.s, e: r.e, cls, id, kind }); };
      const plains = paras;
      for (const l of store.project.links) {
        if (l.researchId !== doc.id || !l.rAnchor || !l.rAnchor.parts) continue;
        l.rAnchor.parts.forEach((pt) => add(resolvePart(plains, pt), 'hr', l.id, 'r'));
      }
      if (ui.linking && ui.linking.from === 'research' && ui.linking.docId === doc.id && ui.linking.rParts) {
        ui.linking.rParts.forEach((pt) => add(resolvePart(plains, pt), 'hp', 'pending', 'p'));
      }
      const hasText = paras.length && (paras.length > 1 || paras[0]);
      bodyContent = hasText
        ? html`<div id="readerBody" @mouseup=${() => this.#onMouseUp()} @click=${(e) => this.#onClickMark(e)}>
            ${paras.map((p, pi) => unsafeHTML('<p data-ri="' + pi + '">' + (blockHTML(paraAsBlock(p), map[pi]) || '&nbsp;') + '</p>'))}
          </div>`
        : html`<div class="empty">Nothing here yet. Switch to <b>Edit</b> to write this source, then select passages to link them to the script.</div>`;
    }

    return html`
      <div class="rhead">
        <pd-button @click=${() => this.#back()}>Back</pd-button>
        <input class="rtitle" type="text" .value=${doc.title || ''} @input=${(e) => this.#title(e)}>
        ${doc.kind === 'link' && doc.url ? html`<a class="rurl" href=${doc.url} target="_blank" rel="noopener">${doc.url.replace(/^https?:\/\//, '')}</a>` : nothing}
        ${lostArr.length ? html`<button class="btn-like" style="background:var(--warn);height:24px;padding:0 10px;border:0;border-radius:var(--r);font-size:11px;cursor:pointer;font-family:var(--sans)" @click=${() => this.#reattachLost(lostArr)}>${lostArr.length} link${lostArr.length === 1 ? '' : 's'} lost · reattach</button>` : nothing}
        <div class="mode">
          <button class=${ui.readerEdit ? '' : 'on'} @click=${() => this.#setMode(false)}>Read</button>
          <button class=${ui.readerEdit ? 'on' : ''} @click=${() => this.#setMode(true)}>Edit</button>
        </div>
        <pd-button variant="ghost" title="Delete source" @click=${() => this.#delete()}>Delete</pd-button>
      </div>
      ${bodyContent}
    `;
  }
}

customElements.define('pandemonium-research-reader', PandemoniumResearchReader);

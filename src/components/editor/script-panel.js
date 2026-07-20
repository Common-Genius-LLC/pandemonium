'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { getParsed } from '../../fountain/cache.js';
import { blockHTML, CONTENT_TYPES } from '../../fountain/blocks.js';
import { scenesOf } from '../../fountain/blocks.js';
import { captureParts, getRootSelection } from '../../utils/selection.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { openPair } from '../../state/actions.js';
import { esc, fmtT, clamp } from '../../utils/format.js';
import { panelStyles } from '../../styles/shared.js';
import '../ui/button.js';

// Phase 1: the original Preview/Edit split, kept as-is on purpose so this
// migration phase changes architecture without changing behavior. This is
// also exactly the component Phase 3 replaces with a single CodeMirror
// surface -- see src/components/editor/decorated-editor.js in that phase.
//
// Selection handling lives here for the Preview view specifically (the
// original bug: Edit mode / the raw textarea has no selection listeners at
// all, so a script fresh out of "Add new script" -- which starts in Edit
// mode -- can never be highlighted-to-link). Bug 2 (non-final drafts
// silently ignore a selection) is fixed by dispatching a distinct
// 'non-final' toolbar kind instead of returning early.
export class PandemoniumScriptPanel extends LitElement {
  static styles = [panelStyles, css`
    #draftBanner{
      flex:none;background:var(--warn);color:var(--ink);padding:7px 12px;border-radius:var(--r);
      margin-bottom:8px;display:flex;align-items:center;gap:10px;font-size:11px;
    }
    .editing-mark{height:3px;background:var(--act);border-radius:2px;flex:none;margin-bottom:6px;display:none}
    :host(.editing) .editing-mark{display:block}
    .wc{color:var(--mut);font-size:10px;white-space:nowrap}
    #scriptScroll{height:100%}
    .script-doc{font-family:var(--mono);font-size:13px;line-height:1.65;color:var(--ink);padding:8px 4px 40vh 4px}
    .fb{white-space:pre-wrap;word-wrap:break-word}
    .fb.scene{font-weight:700;text-transform:uppercase;margin:26px 0 10px;letter-spacing:.02em}
    .fb.scene:first-child{margin-top:4px}
    .fb.action{margin:10px 0}
    .fb.character{margin:16px auto 0;text-align:center;text-transform:uppercase}
    .fb.paren{margin:0 auto;text-align:center;color:var(--ui)}
    .fb.dialogue{margin:0 auto;max-width:62%;text-align:left}
    .fb.transition{text-align:right;margin:16px 0;text-transform:uppercase}
    .fb.centered{text-align:center;margin:12px 0}
    .fb.lyric{font-style:italic;margin:2px 0 2px 1.5em}
    .fb.section{font-family:var(--sans);font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:30px 0 6px}
    .fb.synopsis{font-family:var(--sans);font-size:11px;color:var(--mut);font-style:italic;margin:2px 0 8px}
    .fb.page{height:1px;background:var(--panel);margin:26px 0}
    .fb .note{color:var(--mut);font-family:var(--sans);font-size:11px}
    .fb i{font-style:italic}.fb b{font-weight:700}.fb u{text-decoration:underline}
    .tp{font-family:var(--mono);text-align:center;color:var(--ink);margin:24px 0 40px}
    .tp .t{font-size:15px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
    .tp .m{color:var(--mut);font-size:12px}
    mark{background:none;color:inherit;border-radius:1px}
    mark.hb{background:var(--board);cursor:pointer}
    mark.hr{background:var(--res);color:#fff;cursor:pointer}
    mark.hb.hr{background:linear-gradient(180deg,var(--board) 50%,var(--res) 50%);color:var(--ink);cursor:pointer}
    mark.hp{background:var(--pend)}
    mark.pulse{animation:pulse 1s ease-in-out 2}
    @keyframes pulse{50%{filter:brightness(.82)}}
    #scriptEditor{
      width:100%;height:100%;resize:none;background:var(--bg);color:var(--ink);font-family:var(--mono);
      font-size:13px;line-height:1.65;padding:8px 4px;display:block;border-radius:0;
    }
  `];

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

  #setMode(edit) {
    this._store.store.setUI({ edit });
    if (edit) this.updateComplete.then(() => { const ed = this.renderRoot.getElementById('scriptEditor'); if (ed) ed.focus(); });
  }

  #onInput(e) {
    const sc = this._store.store.activeScript();
    this._store.store.updateScriptTextLive(sc.id, e.target.value);
  }

  #completePendingRelink(parts) {
    const store = this._store.store;
    const pr = store.ui.pendingRelink;
    store.setUI({ pendingRelink: null });
    getRootSelection(this.renderRoot).removeAllRanges();
    if (pr.type === 'new-board') {
      const input = this.renderRoot.getElementById('fileImg');
      input.value = '';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const img = await readFileAsDataURL(file);
        store.addBoard({ parts, img, caption: '' });
        dispatch(this, 'pandemonium-toast', { message: 'Board added.' });
      };
      input.click();
      return;
    }
    if (pr.type === 'board') { store.reattachBoard(pr.id, parts); dispatch(this, 'pandemonium-toast', { message: 'Reattached.' }); return; }
    if (pr.type === 'link') { store.reattachLink(pr.id, parts); dispatch(this, 'pandemonium-toast', { message: 'Reattached.' }); }
  }

  #onMouseUp() {
    setTimeout(() => {
      const store = this._store.store;
      const ui = store.ui;
      const sc = store.activeScript();
      const preview = this.renderRoot.getElementById('scriptPreview');
      if (!preview) return;
      const parts = captureParts(preview, 'data-bi', this.renderRoot);
      if (!parts) return;
      if (!sc.final) {
        const rect = getRootSelection(this.renderRoot).getRangeAt(0).getBoundingClientRect();
        dispatch(this, 'pandemonium-show-selection-toolbar', { kind: 'non-final', parts, anchorRect: rect, scriptId: sc.id });
        return;
      }
      if (ui.linking && ui.linking.from === 'research') {
        store.addLink({ researchId: ui.linking.docId, sParts: parts, rParts: ui.linking.rParts });
        store.setUI({ linking: null });
        getRootSelection(this.renderRoot).removeAllRanges();
        dispatch(this, 'pandemonium-toast', { message: 'Linked.' });
        return;
      }
      if (ui.pendingRelink) { this.#completePendingRelink(parts); return; }
      const rect = getRootSelection(this.renderRoot).getRangeAt(0).getBoundingClientRect();
      dispatch(this, 'pandemonium-show-selection-toolbar', { kind: 'script', parts, anchorRect: rect });
    }, 0);
  }

  #onClickHighlight(e) {
    const mk = e.target.closest('mark');
    if (!mk) return;
    const sel = getRootSelection(this.renderRoot);
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) return;
    const toks = (mk.dataset.hl || '').split(/\s+/);
    const rTok = toks.find((t) => t.indexOf('r:') === 0);
    const bTok = toks.find((t) => t.indexOf('b:') === 0);
    if (rTok) { openPair(this._store.store, rTok.slice(2)); e.stopPropagation(); return; }
    if (bTok) { dispatch(this, 'pandemonium-show-board-popover', { boardId: bTok.slice(2), anchor: mk }); e.stopPropagation(); }
  }

  #scrollToBlock(bi) {
    const el = this.renderRoot.querySelector(`#scriptPreview [data-bi="${bi}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.style.background = 'var(--act)';
    setTimeout(() => { el.style.background = ''; }, 900);
  }

  updated() {
    const ui = this._store.ui;
    if (!ui) return;
    this.classList.toggle('editing', !!ui.edit);

    if (ui.scrollToBlock != null) {
      const bi = ui.scrollToBlock;
      this._store.store.setUI({ scrollToBlock: null });
      requestAnimationFrame(() => this.#scrollToBlock(bi));
    }

    cancelAnimationFrame(this.#connRAF);
    if (!ui.pair) { this.#lastPulsed = null; dispatch(this, 'pandemonium-connector-point', { side: 'script', rect: null }); return; }
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
      }
      dispatch(this, 'pandemonium-connector-point', { side: 'script', rect });
      this.#connRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  render() {
    const store = this._store.store;
    const project = this._store.project;
    if (!project) return html``;
    const ui = store.ui;
    const sc = store.activeScript();
    const parsed = getParsed(sc);
    const finalScript = store.finalScript();

    const words = parsed.blocks.reduce((a, b) => a + (CONTENT_TYPES[b.type] ? b.words : 0), 0);
    const secs = scenesOf(parsed).reduce((a, s) => a + s.secs, 0);
    const wc = words ? words.toLocaleString() + ' w · est ' + fmtT(secs) : '';

    return html`
      <div class="phead">
        <span class="lbl">Script</span><span class="sub">${sc.name}${sc.final ? ' · final draft' : ''}</span>
        <div class="tools">
          <span class="wc">${wc}</span>
          <div class="mode">
            <button class=${ui.edit ? '' : 'on'} @click=${() => this.#setMode(false)}>Preview</button>
            <button class=${ui.edit ? 'on' : ''} @click=${() => this.#setMode(true)}>Edit</button>
          </div>
        </div>
      </div>
      ${!sc.final ? html`
        <div id="draftBanner">
          <span>Boards &amp; sources attach to the final draft, <b>${finalScript.name}</b>.</span>
          <pd-button @click=${() => store.makeFinal(sc.id)}>Make this final</pd-button>
          <pd-button @click=${() => store.setUI({ draftId: finalScript.id })}>View final</pd-button>
        </div>` : nothing}
      <div class="editing-mark"></div>
      <div class="pbody" id="scriptScroll">
        ${ui.edit
          ? html`<textarea id="scriptEditor" spellcheck="false" .value=${sc.text} @input=${(e) => this.#onInput(e)}></textarea>`
          : this.#renderPreview(sc, parsed)}
      </div>
      <input type="file" id="fileImg" accept="image/*" style="display:none">
    `;
  }

  #renderPreview(sc, parsed) {
    const store = this._store.store;
    const finalState = store.getFinalState();
    const useHl = sc.final ? finalState.R.biMap : {};
    const T = parsed.title;
    let html_ = '';
    if (T.title) {
      html_ += '<div class="tp"><div class="t">' + esc(T.title) + '</div>';
      if (T.credit) html_ += '<div class="m">' + esc(T.credit) + '</div>';
      if (T.author || T.authors) html_ += '<div class="m">' + esc(T.author || T.authors) + '</div>';
      if (T['draft date']) html_ += '<div class="m">' + esc(T['draft date']) + '</div>';
      html_ += '</div>';
    }
    for (const b of parsed.blocks) {
      if (b.type === 'page') { html_ += '<div class="fb page"></div>'; continue; }
      const inner = blockHTML(b, useHl[b.i]);
      html_ += '<div class="fb ' + b.type + '" data-bi="' + b.i + '">' + (inner || '&nbsp;') + '</div>';
    }
    if (!parsed.blocks.length && !T.title) {
      html_ = '<div class="empty" style="font-family:var(--sans)">Empty script. Switch to <b>Edit</b> and write in Fountain: scene headings like INT. ROOM - DAY, character names in caps, dialogue underneath.</div>';
    }
    return html`<div class="script-doc" id="scriptPreview" @mouseup=${() => this.#onMouseUp()} @click=${(e) => this.#onClickHighlight(e)}>${unsafeHTML(html_)}</div>`;
  }
}

customElements.define('pandemonium-script-panel', PandemoniumScriptPanel);

'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { keyed } from 'lit/directives/keyed.js';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { blockHTML } from '../../fountain/blocks.js';
import { resolvePart } from '../../fountain/resolve.js';
import {
  docParas, paraAsBlock, docTitle, normalizeUrl, NOTE_COLORS,
  parasToBody, setPara, splitPara, mergePara, colorToken,
  addLabel, removeLabel, allLabels, MAX_LABEL,
} from '../../data/research-doc.js';
import { sourceIcon, sourceLabel, icon } from './icons.js';
import { captureParts, getRootSelection } from '../../utils/selection.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { clamp } from '../../utils/format.js';
import { openPair } from '../../state/actions.js';
import { formStyles } from '../../styles/shared.js';
import './attachment-viewer.js';
import '../ui/link-preview.js';
import { storablePreview } from '../../data/link-preview.js';

// One open source: its media, the page it came from, the notes about it, and
// the script passages it backs, down one page.
//
// THERE IS NO EDIT MODE. The reader used to carry a Read / Write switch, which
// meant the same surface did different things depending on state you could
// only find by looking at a toggle: in one you could select a passage and link
// it but not fix a typo, in the other the reverse. Notes are now edited where
// they are read, a paragraph at a time, the way this app already edits script
// lines during a slideshow (see #commitLineEdit there, and the two lessons
// kept from it: use composedPath rather than target when a document-level
// handler has to know whether a line is focused, and remount a contenteditable
// through keyed() after an edit, because the browser disturbs Lit's marker
// nodes).
//
// A link highlight inside the notes stays an object, not text: the cursor
// turns from a caret to a pointer over it, and clicking it opens the pair
// instead of putting a caret in it. That is the whole of what has to be
// learned here, and the cursor teaches it without being told.
//
// Anchors survive all of this without re-derivation, because a research anchor
// is a quoted string searched for across every paragraph (fountain/resolve.js),
// not an offset: splitting, merging and retyping paragraphs moves the quote
// around, and a link is only lost when the quote itself is gone.
export class PandemoniumResearchReader extends LitElement {
  static styles = [formStyles, css`
    :host{display:flex;flex-direction:column;min-height:0;height:100%;padding:10px;box-sizing:border-box}
    /* The open source IS the card from the grid, opened: same rounding, same
       colour, so the object that was clicked and the object that appeared are
       plainly the same one. */
    .card{
      flex:1;min-height:0;display:flex;flex-direction:column;
      background:var(--card,var(--note-plain));border-radius:12.36px;overflow:hidden;
    }
    .rhead{flex:none;display:flex;align-items:center;gap:6px;padding:10px 10px 6px}
    .rhead .kind{flex:none;line-height:0}
    .rhead .kind svg{width:14px;height:14px;fill:var(--mut)}
    .rtitle{
      font-size:13px;font-weight:500;color:var(--ink);background:transparent;padding:2px 6px;flex:1;min-width:0;
      border:0;border-radius:var(--r);font-family:var(--sans);height:auto;
    }
    .rtitle:hover,.rtitle:focus{background:var(--bg)}
    /* Counts in the header are buttons that go somewhere, never statistics:
       one scrolls to the list of passages this source backs, the other starts
       reattaching a link whose passage is gone. */
    .countpill{
      flex:none;height:22px;padding:0 10px;font-family:var(--sans);font-size:11px;font-weight:500;
      color:var(--res);background:none;border:0;border-radius:20px;cursor:pointer;white-space:nowrap;
    }
    .countpill:hover{background:var(--bg)}
    .countpill.warn{color:var(--ink);background:var(--warn)}
    .more{
      width:24px;height:24px;flex:none;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:transparent;color:var(--mut);font-family:var(--sans);font-size:14px;line-height:1;
    }
    .more:hover{background:var(--bg);color:var(--ink)}
    /* Close sits last, at the far right, because that is where a control that
       dismisses what you are looking at is looked for. Opening a source takes
       the panel over rather than navigating anywhere, so the way out is a
       dismiss, not a back. */
    .close{font-size:12px}

    /* The link box. On the note's own colour at rest, white on hover and
       while editing: the hover shows what a click will do, so the box needs no
       Edit button and no border to say it is editable. */
    .linkbox{
      display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12.36px;
      background:transparent;cursor:text;transition:background .12s;
    }
    .linkbox:hover,.linkbox:focus-within{background:var(--bg)}
    .linkbox svg{width:13px;height:13px;flex:none;fill:var(--mut)}
    .linkbox input{
      flex:1;min-width:0;height:20px;padding:0;font-size:12px;
      background:transparent;border:0;border-radius:0;color:var(--link);
      text-overflow:ellipsis;cursor:text;
    }
    .linkbox input:focus-visible{border:0;outline:0}
    .linkbox input::placeholder{color:var(--mut)}

    /* Topics. Neutral chips on purpose: the source's own colour is the other
       way of sorting, and two colour systems on one card would be one more
       thing to hold in mind, not one fewer. */
    .labels{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:2px 0 12px}
    .tag{
      display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 4px 0 9px;
      font-family:var(--sans);font-size:11px;color:var(--ink);background:var(--bg);border-radius:20px;
    }
    .tag button{
      width:15px;height:15px;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:none;color:var(--mut);font-family:var(--sans);font-size:9px;line-height:1;
    }
    .tag button:hover{background:var(--panel);color:var(--ink)}
    .addtag{
      height:20px;padding:0 9px;font-family:var(--sans);font-size:11px;font-weight:500;color:var(--mut);
      background:none;border:0;border-radius:20px;cursor:pointer;
    }
    .addtag:hover{background:var(--bg);color:var(--ink)}
    .taginput{
      height:20px;width:120px;padding:0 9px;font-size:11px;
      background:var(--field);border:1px solid var(--link);border-radius:20px;
    }

    #readerBody{
      flex:1;overflow:auto;line-height:1.7;font-size:12px;color:var(--ink);padding:0 14px 24px;
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    .media{margin-bottom:10px}
    /* The notes are the note. Big text on the card's own fill, no field, no
       border, no box: what a sticky note looks like, which is also what tells
       you it is yours to write on. The tall min-height is deliberate, so there
       is a surface to click into rather than a single line hugging the top. */
    .notes{min-height:45vh;cursor:text;padding-bottom:12vh}
    /* A paragraph IS the editor. The caret cursor and the hover wash are the
       only signifiers it needs: text you can put a caret in. */
    .para{
      margin:0 0 .55em;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text;
      font-size:17px;line-height:1.55;letter-spacing:-0.1px;
      border:0;outline:0;min-height:1.55em;
    }
    /* The first paragraph of an empty source says what to do IN the place
       where doing it happens, rather than in a sentence above it. */
    .para.ph::before{content:attr(data-ph);color:var(--mut);pointer-events:none;font-size:17px}
    .para.ph:focus::before{opacity:.55}
    #readerBody mark.hr{background:var(--res);color:#fff;cursor:pointer;border-radius:1px}
    #readerBody mark.hp{background:var(--pend);border-radius:1px}
    #readerBody mark.pulse{animation:pulse 1s ease-in-out 2}
    @keyframes pulse{50%{filter:brightness(.82)}}

    /* The passages this source backs: the link's other end, made visible.
       Before this, the research side could only be reached from the script,
       and a link could only be removed from the bar that appears after
       clicking a highlight. */
    .backs{margin-top:28px;border-radius:12.36px;background:var(--bg);padding:10px 12px}
    .backs h4{margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
    /* The same block before there is anything in it, so the answer appears
       where the question was asked. */
    .backs.empty{background:none;padding:10px 0}
    .backs.empty p{margin:0 0 4px;font-size:11px;line-height:1.6;color:var(--mut)}
    .backs.empty b{font-weight:500;color:var(--ink)}
    .backrow{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11px;min-width:0}
    .backrow .q{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);cursor:pointer}
    .backrow .q:hover{text-decoration:underline}
    .backrow.lost .q{color:var(--mut);font-style:italic;cursor:default}
    .backrow.lost .q:hover{text-decoration:none}
    .backrow .whole{flex:none;color:var(--mut);font-size:10px}
    .backrow button{
      flex:none;font-family:var(--sans);font-size:10px;font-weight:500;color:var(--mut);
      background:none;border:0;padding:2px 4px;cursor:pointer;border-radius:var(--r);
    }
    .backrow button:hover{background:var(--panel);color:var(--ink)}

    @media (max-width:900px){
      .rhead{flex-wrap:wrap}
      .rtitle{order:2;flex-basis:100%}
    }
  `];

  static properties = { doc: { type: Object }, _adding: { state: true } };

  #connRAF = 0;
  #lastPulsed = null;
  // Bumped on every paragraph commit, and used to key the paragraph list:
  // contenteditable input, even a revert, leaves DOM Lit did not author, so
  // the list is remounted rather than patched (the slideshow's lesson).
  #editGen = 0;
  // {pi, offset} to put the caret at once the next render lands, after a
  // split, a merge, or opening a source that was just created.
  #pendingCaret = null;
  #lastOpened = null;

  constructor() {
    super();
    this._store = new StoreController(this);
    this._adding = false; // the label input is open
  }

  connectedCallback() {
    super.connectedCallback();
    // Escape closes the source, but only when nothing is being typed into: a
    // focused paragraph owns Escape for its own revert. composedPath, not
    // target, because the paragraph lives in this shadow root.
    this._onKeydown = (e) => {
      if (e.key !== 'Escape') return;
      if (e.composedPath().some((el) => el && (el.isContentEditable || el.tagName === 'INPUT'))) return;
      if (this._store.ui && this._store.ui.openDoc === (this.doc && this.doc.id)) this.#close();
    };
    document.addEventListener('keydown', this._onKeydown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown);
    cancelAnimationFrame(this.#connRAF);
    super.disconnectedCallback();
  }

  #close() {
    this._store.store.setUI({ openDoc: null, openDocFocus: false, pair: null });
  }

  #title(e) { this._store.store.updateResearch(this.doc.id, { title: e.target.value }); }

  // Committed on blur, not per keystroke: a URL is meaningless half-typed, and
  // normalising mid-entry would fight the caret.
  #url(e) {
    const typed = e.target.value.trim();
    const url = typed ? (normalizeUrl(typed) || typed) : '';
    if (url === (this.doc.url || '')) return;
    // The old preview described the old page: dropped with it, so the grid
    // never shows one page's card under another page's link.
    this._store.store.updateResearch(this.doc.id, { url, preview: null });
  }

  // The server's read of the page, kept on the source so the grid can draw
  // its card offline and the source can be named after the page. Written only
  // when it says something new, so reopening a source is not an edit.
  #keepPreview(p) {
    const next = storablePreview(p);
    const d = this.doc;
    if (!next || next.url !== d.url) return;
    if (JSON.stringify(next) === JSON.stringify(d.preview || null)) return;
    this._store.store.updateResearch(d.id, { preview: next });
  }

  // ---- editing the notes in place ----

  #paras() { return docParas(this.doc); }

  // Every commit remounts the paragraph list (see #editGen), which drops the
  // caret unless we say where to put it back. A split or a merge knows; a
  // plain commit does not, so it looks at where the caret actually is. That
  // matters for the commonest move of all, clicking from one paragraph
  // straight into the next: the blur commits the first, and the re-render
  // would otherwise replace the paragraph the click had just landed in.
  #setParas(next, caret) {
    this.#editGen++;
    this.#pendingCaret = caret || this.#liveCaret();
    this._store.store.updateResearch(this.doc.id, { body: parasToBody(next) });
  }

  // Where the caret is at this instant, if it is in a paragraph at all.
  #liveCaret() {
    const active = this.renderRoot.activeElement;
    if (!active || !active.classList || !active.classList.contains('para')) return null;
    const pi = Number(active.getAttribute('data-ri'));
    return Number.isFinite(pi) ? { pi, offset: this.#caretOffset(active) } : null;
  }

  // How far into the element the caret sits, counted in the text the reader
  // sees. Measured with a range rather than read off the selection node,
  // because a paragraph the browser has edited may hold several text nodes.
  #caretOffset(el) {
    const sel = getRootSelection(this.renderRoot);
    if (!sel || !sel.rangeCount) return 0;
    const live = sel.getRangeAt(0);
    if (!el.contains(live.endContainer)) return 0;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(live.endContainer, live.endOffset);
    return r.toString().length;
  }

  // innerText rather than textContent: a soft break (Shift+Enter) is a <br>,
  // which textContent drops silently and innerText reports as the newline the
  // writer actually typed.
  #textOf(el) { return el.innerText.replace(/\n+$/, ''); }

  // `gen` is the edit generation the paragraph was rendered in. A commit from
  // an older one is refused, because it is a blur arriving from a paragraph
  // that no longer exists: Enter splits a paragraph and re-renders the list,
  // and a browser that fires blur on the element it just removed would
  // otherwise commit the WHOLE pre-split text back over the first half.
  // Whether a browser fires that blur is not settled between engines, which is
  // exactly why it is guarded rather than relied on either way.
  #commitPara(pi, text, gen) {
    if (gen !== this.#editGen) return;
    const paras = this.#paras();
    if (paras[pi] === text) return;
    this.#setParas(setPara(paras, pi, text));
  }

  // Enter splits the paragraph at the caret, which is what "a new paragraph"
  // means everywhere else the writer types. Shift+Enter falls through to the
  // browser's own soft break inside the paragraph.
  #splitPara(pi, el) {
    const out = splitPara(this.#paras(), pi, this.#textOf(el), this.#caretOffset(el));
    this.#setParas(out.paras, out.caret);
  }

  // Backspace at the very start folds this paragraph into the one above, caret
  // left at the join: the standard behaviour, and the only way to undo a split
  // without reaching for a menu.
  #mergeParaBack(pi, el) {
    const out = mergePara(this.#paras(), pi, this.#textOf(el));
    if (out) this.#setParas(out.paras, out.caret);
  }

  #onParaKeydown(e, pi) {
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.#splitPara(pi, el);
      return;
    }
    if (e.key === 'Backspace' && pi > 0 && this.#caretOffset(el) === 0) {
      const sel = getRootSelection(this.renderRoot);
      if (sel && sel.rangeCount && sel.getRangeAt(0).collapsed) {
        e.preventDefault();
        e.stopPropagation();
        this.#mergeParaBack(pi, el);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Reverted through the browser's own edit pipeline, not by assigning
      // textContent: this element is Lit-templated, and replacing its children
      // wholesale ejects Lit's marker nodes and breaks every later render.
      const original = this.#paras()[pi] || '';
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, original);
      el.blur();
    }
  }

  // Clicking a link highlight opens the pair rather than putting a caret in
  // it, so a highlight reads as an object. The mousedown is what actually has
  // to be stopped: it is the event that moves the caret.
  #onBodyMouseDown(e) {
    const mk = e.target.closest && e.target.closest('mark.hr');
    if (mk) e.preventDefault();
  }

  // Clicking the empty space below the notes puts the caret at the end of
  // them, which is what clicking under text means in every editor. Scoped to
  // the notes, not to the whole scroller: when it covered the scroller it also
  // swallowed clicks on the link field and the label field, which made both of
  // them impossible to use.
  #onNotesClick(e) {
    if (e.target.closest && e.target.closest('.para')) return;
    const paras = this.renderRoot.querySelectorAll('.para');
    const last = paras[paras.length - 1];
    if (!last) return;
    this.#pendingCaret = { pi: paras.length - 1, offset: this.#textOf(last).length };
    this.#applyCaret();
  }

  #onClickMark(e) {
    const mk = e.target.closest && e.target.closest('mark');
    if (!mk) return;
    const sel = getRootSelection(this.renderRoot);
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) return;
    const rTok = (mk.dataset.hl || '').split(/\s+/).find((t) => t.indexOf('r:') === 0);
    if (rTok) { openPair(this._store.store, rTok.slice(2)); e.stopPropagation(); }
  }

  // ---- the source's own actions ----

  #delete() {
    const d = this.doc;
    const n = this._store.store.project.links.filter((l) => l.researchId === d.id).length;
    const warn = n ? ' and its ' + n + ' link' + (n === 1 ? '' : 's') + ' to the script' : '';
    if (!confirm('Delete "' + docTitle(d) + '"' + warn + '?')) return;
    this._store.store.deleteResearch(d.id);
    dispatch(this, 'pandemonium-toast', { message: 'Source deleted.' });
  }

  #pickFile() {
    const input = this.renderRoot.getElementById('fileAtt');
    input.value = '';
    input.click();
  }

  async #onFilePicked(e) {
    const file = (e.target.files || [])[0];
    if (!file) return;
    const data = await readFileAsDataURL(file);
    this._store.store.updateResearch(this.doc.id, {
      attachment: { name: file.name, mime: file.type, data },
      // A source named after a file it no longer holds would be a lie; one the
      // writer titled themselves is left alone.
      title: (this.doc.title || '').trim() ? this.doc.title : file.name,
    });
  }

  #removeFile() {
    if (!confirm('Remove the file from this source? Its notes and links stay.')) return;
    this._store.store.updateResearch(this.doc.id, { attachment: null });
  }

  #menu(e) {
    const store = this._store.store;
    const d = this.doc;
    const hasFile = !!(d.attachment && d.attachment.data);
    const items = [
      {
        swatches: NOTE_COLORS.map((c) => ({
          label: c.label,
          color: c.dot,
          selected: (d.color || null) === c.key,
          fn: () => store.updateResearch(d.id, { color: c.key }),
        })),
      },
      { divider: true },
      { label: hasFile ? 'Replace the file' : 'Add a file', fn: () => this.#pickFile() },
      ...(hasFile ? [{ label: 'Remove the file', fn: () => this.#removeFile() }] : []),
      { divider: true },
      { label: 'Delete source', danger: true, fn: () => this.#delete() },
    ];
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items });
  }

  // autofocus is unreliable inside a shadow root, and both of these inputs
  // exist only because the writer just asked for one: focus it outright.
  #focusAfterRender(sel) {
    this.updateComplete.then(() => {
      const el = this.renderRoot.querySelector(sel);
      if (el) { el.focus(); if (el.select) el.select(); }
    });
  }

  // ---- labels ----

  #addLabel(text) {
    const d = this.doc;
    const next = addLabel(d.labels, text);
    if (next !== (d.labels || [])) this._store.store.updateResearch(d.id, { labels: next });
    this._adding = false;
  }

  #removeLabel(text) {
    const d = this.doc;
    this._store.store.updateResearch(d.id, { labels: removeLabel(d.labels, text) });
  }

  #onLabelKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.#addLabel(e.target.value); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._adding = false; }
  }

  // One affordance for both cases: the field suggests every label already in
  // the project, and typing something that is not in the list creates it.
  // There is no separate "manage labels" anywhere, because there is nothing to
  // manage: a label exists exactly as long as something carries it.
  #labels(doc) {
    const labels = doc.labels || [];
    const known = allLabels(this._store.project.research)
      .map((l) => l.label)
      .filter((l) => !labels.some((x) => x.toLowerCase() === l.toLowerCase()));
    return html`
      <div class="labels">
        ${labels.map((l) => html`<span class="tag">${l}<button title="Remove this label" @click=${() => this.#removeLabel(l)}>&#10005;</button></span>`)}
        ${this._adding
          ? html`<input class="taginput" list="knownLabels" maxlength=${MAX_LABEL} placeholder="Topic name"
              @keydown=${(e) => this.#onLabelKeydown(e)}
              @blur=${(e) => this.#addLabel(e.target.value)}>
            <datalist id="knownLabels">${known.map((l) => html`<option value=${l}></option>`)}</datalist>`
          : html`<button class="addtag" title="Group this source under a topic"
              @click=${() => { this._adding = true; this.#focusAfterRender('.taginput'); }}>+ Label</button>`}
      </div>
    `;
  }

  #reattach(linkId) {
    const store = this._store.store;
    store.setUI({ pendingRelink: { type: 'link', id: linkId }, draftId: store.finalScript().id });
  }

  #unlink(linkId) {
    if (!confirm('Remove this link between the script and this source?')) return;
    const store = this._store.store;
    store.deleteLink(linkId);
    if (store.ui.pair === linkId) store.setUI({ pair: null });
    dispatch(this, 'pandemonium-toast', { message: 'Unlinked.' });
  }

  #scrollToBacks() {
    const el = this.renderRoot.querySelector('.backs');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  #onMouseUp() {
    setTimeout(() => {
      const store = this._store.store;
      const ui = store.ui;
      const body = this.renderRoot.querySelector('.notes');
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

  // Puts the caret at {pi, offset} in the freshly rendered paragraph list.
  #applyCaret() {
    const want = this.#pendingCaret;
    this.#pendingCaret = null;
    if (!want) return;
    const el = this.renderRoot.querySelector(`.para[data-ri="${want.pi}"]`);
    if (!el) return;
    el.focus();
    const node = el.firstChild;
    const range = document.createRange();
    if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, clamp(want.offset, 0, node.length));
    } else {
      range.selectNodeContents(el);
      range.collapse(true);
    }
    range.collapse(true);
    const sel = getRootSelection(this.renderRoot);
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  updated() {
    const ui = this._store.ui;
    if (!ui) return;

    // A source that was just created starts with the caret in its notes:
    // there is nothing to read yet, so the only sensible thing to do is type.
    if (ui.openDocFocus && ui.openDoc && ui.openDoc !== this.#lastOpened) {
      this.#lastOpened = ui.openDoc;
      this._store.store.setUI({ openDocFocus: false });
      this.#pendingCaret = { pi: 0, offset: 0 };
    }
    if (this.#pendingCaret) requestAnimationFrame(() => this.#applyCaret());

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

  // A source that backs nothing yet. This is the one thing about the panel
  // that cannot be worked out by looking at it, because the link is made from
  // a selection and an unmade link has nothing on screen to point at. It is
  // said HERE, in the place the answer will occupy once there is one, and it
  // names both directions, because either end can start a link.
  #noBacks(hasNotes) {
    return html`
      <div class="backs empty">
        <h4>Not linked to the script yet</h4>
        <p>${hasNotes
          ? 'Select any passage above to link it to a passage of the script.'
          : 'Write something above, then select a passage of it to link.'}</p>
        <p>Or from a line in the script, use <b>link to</b> and choose Research.</p>
      </div>
    `;
  }

  #backs(items, hasNotes) {
    if (!items.length) return this.#noBacks(hasNotes);
    return html`
      <div class="backs">
        <h4>Backs ${items.length} passage${items.length === 1 ? '' : 's'} of the script</h4>
        ${items.map((o) => {
          const q = ((o.lk.anchor && o.lk.anchor.parts[0] && o.lk.anchor.parts[0].q) || '').trim();
          const whole = !(o.lk.rAnchor && o.lk.rAnchor.parts && o.lk.rAnchor.parts.length);
          return html`
            <div class="backrow ${o.ok ? '' : 'lost'}">
              <span class="q" title=${o.ok ? 'Go to this passage in the script' : 'This passage is no longer in the final draft'}
                @click=${() => { if (o.ok) openPair(this._store.store, o.lk.id); }}>${q || 'Untitled passage'}</span>
              ${whole ? html`<span class="whole" title="This link points at the source as a whole, not at a passage inside it">whole source</span>` : nothing}
              ${o.ok ? nothing : html`<button @click=${() => this.#reattach(o.lk.id)}>Reattach</button>`}
              <button @click=${() => this.#unlink(o.lk.id)}>Unlink</button>
            </div>
          `;
        })}
      </div>
    `;
  }

  #notes(doc, ui, store) {
    const paras = this.#paras();
    const map = {};
    const add = (r, cls, id, kind) => { if (!r) return; (map[r.bi] = map[r.bi] || []).push({ s: r.s, e: r.e, cls, id, kind }); };
    for (const l of store.project.links) {
      if (l.researchId !== doc.id || !l.rAnchor || !l.rAnchor.parts) continue;
      l.rAnchor.parts.forEach((pt) => add(resolvePart(paras, pt), 'hr', l.id, 'r'));
    }
    if (ui.linking && ui.linking.from === 'research' && ui.linking.docId === doc.id && ui.linking.rParts) {
      ui.linking.rParts.forEach((pt) => add(resolvePart(paras, pt), 'hp', 'pending', 'p'));
    }
    const lone = paras.length === 1 && !paras[0];
    const ph = doc.attachment && doc.attachment.data
      ? 'Write what this shows'
      : 'Write or paste what this source says';
    const gen = this.#editGen;
    return keyed(gen, html`${paras.map((p, pi) => html`<p
      class="para ${lone ? 'ph' : ''}"
      data-ri=${pi}
      data-ph=${ph}
      contenteditable="true"
      @keydown=${(e) => this.#onParaKeydown(e, pi)}
      @input=${(e) => e.currentTarget.classList.toggle('ph', lone && !e.currentTarget.textContent)}
      @blur=${(e) => {
        const text = this.#textOf(e.currentTarget);
        // A frame late on purpose: blur runs mid focus-change, so the caret
        // has not arrived anywhere yet. By the next frame it has, and the
        // commit can put it back where the writer actually clicked. Safe if
        // the reader is gone by then (closing the source blurs it): the
        // StoreController keeps its store, so the last edit still lands.
        requestAnimationFrame(() => this.#commitPara(pi, text, gen));
      }}
    >${unsafeHTML(blockHTML(paraAsBlock(p), map[pi]) || '')}</p>`)}`);
  }

  // The link is one box, and the box is the editor. At rest it sits on the
  // note's own colour and reads as the link; hover turns its background white,
  // which is exactly how it looks while being edited, so the hover IS the
  // invitation; a click puts the caret in it. No Edit button, no second state
  // to switch into. Enter or leaving it commits, Escape puts it back.
  //
  // Opening the page is the preview card's job (below), not this box's: one
  // control that both opened a link and edited it would have to guess which
  // the click meant.
  #linkBox(doc) {
    return html`
      <label class="linkbox" title=${doc.url ? 'Click to change the link' : 'Paste a link'}>
        ${icon('link')}
        <input type="url" placeholder="Paste a link" spellcheck="false" .value=${doc.url || ''}
          @keydown=${(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.value = doc.url || ''; e.target.blur(); }
          }}
          @change=${(e) => this.#url(e)}>
      </label>
    `;
  }

  // The page the link points at, as a card inside the note. quiet: when there
  // is nothing rich to show (the page could not be read), it shows nothing,
  // because the box above already shows the link itself.
  #linkPreview(doc) {
    if (!doc.url) return nothing;
    return html`<div class="media"><pd-link-preview quiet .url=${doc.url} .data=${doc.preview || null}
      @pd-link-preview-load=${(e) => this.#keepPreview(e.detail.preview)}></pd-link-preview></div>`;
  }

  render() {
    const doc = this.doc;
    const ui = this._store.ui;
    const store = this._store.store;
    const links = store.getFinalState().R.links.filter((o) => o.lk.researchId === doc.id);
    const lost = links.filter((o) => !o.ok);
    const att = doc.attachment;

    // The open source is the card, opened: same shape, same colour, so what
    // was clicked and what appeared are recognisably one object rather than
    // the pane having been replaced by something else.
    return html`
      <div class="card" style="--card:${colorToken(doc.color)}">
        <div class="rhead">
          <span class="kind" title=${sourceLabel(doc)}>${sourceIcon(doc)}</span>
          <input class="rtitle" type="text" placeholder="Untitled" .value=${doc.title || ''} @input=${(e) => this.#title(e)}>
          ${links.length ? html`<button class="countpill" title="See the passages this source backs" @click=${() => this.#scrollToBacks()}>${links.length} in script</button>` : nothing}
          ${lost.length ? html`<button class="countpill warn" title="Reattach the first of these to a passage" @click=${() => this.#reattach(lost[0].lk.id)}>${lost.length} lost</button>` : nothing}
          <button class="more" title="Colour, file and delete" @click=${(e) => this.#menu(e)}>&#8943;</button>
          <button class="more close" title="Close this source (Esc)" @click=${() => this.#close()}>&#10005;</button>
        </div>
        <div id="readerBody">
          ${att && att.data ? html`<div class="media"><pandemonium-attachment-viewer .attachment=${att}></pandemonium-attachment-viewer></div>` : nothing}
          <div class="media">${this.#linkBox(doc)}</div>
          ${this.#linkPreview(doc)}
          ${this.#labels(doc)}
          <div class="notes"
            @mousedown=${(e) => this.#onBodyMouseDown(e)}
            @mouseup=${() => this.#onMouseUp()}
            @click=${(e) => { this.#onClickMark(e); this.#onNotesClick(e); }}>
            ${this.#notes(doc, ui, store)}
          </div>
          ${this.#backs(links, !!(doc.body || '').trim())}
        </div>
      </div>
      <input type="file" id="fileAtt" style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }
}

customElements.define('pandemonium-research-reader', PandemoniumResearchReader);

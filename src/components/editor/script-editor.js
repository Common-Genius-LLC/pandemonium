'use strict';

import { LitElement, html, css } from 'lit';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { fountainDecorations } from './cm-fountain-plugin.js';
import { sectionAffordances, hoverSectionField } from './cm-sections.js';
import { fountainTheme } from './cm-theme.js';
import { captureFromSelection } from './selection-capture.js';
import { openSourceDialog } from '../research/source-dialog.js';
import { parseFountain } from '../../fountain/parse.js';
import { resolvePart } from '../../fountain/resolve.js';
import { plainPosToRaw, rawOffsetToPlainPos, blockRawRange } from '../../fountain/doc-map.js';
import { elementOfBlock } from '../../fountain/element-ops.js';
import { activeElementField, autoUppercase, applyElementAtCaret, elementKeymap } from './cm-autoformat.js';
import { elementMenu } from './element-menu.js';
import { readFileAsDataURL } from '../../utils/files.js';
import { imageFromClipboard } from '../../utils/clipboard.js';
import { openPair } from '../../state/actions.js';
import { clamp } from '../../utils/format.js';

// The single editable+formatted+linkable script surface that replaces the
// old Preview/Edit split. There is exactly one interaction model here,
// active at all times: select text, get the Board/Source/Note toolbar (or,
// on a non-final draft, a prompt to make it final first). No mode to be in,
// so no mode to accidentally be stuck in.
//
// CodeMirror edits the real document text directly; formatting and
// highlights are pure decorations computed from parseFountain() (see
// cm-fountain-plugin.js). This is what makes "Fountain fidelity is sacred"
// a structural property rather than something to defend by convention --
// there is no HTML round-trip step that could corrupt anything.
export class PandemoniumScriptEditor extends LitElement {
  static styles = css`
    :host{display:block;height:100%}
    .host{height:100%}
    :host(.editing) {} /* legacy hook retained for parent panel styling if needed */
  `;

  #view = null;
  #plugin = null;
  #loadedScriptId = null;
  #connRAF = 0;
  #selRAF = 0;
  #lastPulsed = null;
  #pendingBoardParts = null;
  #reconciling = false;
  #lastEmittedElement = null;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  firstUpdated() {
    const host = this.renderRoot.querySelector('.host');
    this.#plugin = fountainDecorations((parsed) => this.#getHighlights(parsed));
    const script = this._store.store.activeScript();
    this.#loadedScriptId = script.id;
    const state = EditorState.create({
      doc: script.text,
      extensions: [
        history(),
        // Before the element keymap: while the element menu is open it owns
        // Enter and the letter keys (element-menu.js sets its own precedence).
        elementMenu({ onPick: (view, key) => applyElementAtCaret(view, key) }),
        elementKeymap({ getParsed: (v) => v.plugin(this.#plugin)?.parsed || parseFountain(v.state.doc.toString()) }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Shown only while the document is empty, so it appears on a new
        // draft, goes on the first keystroke, and comes back if the writer
        // clears everything out again. CodeMirror owns that toggle.
        placeholder('Start writing your script'),
        EditorView.lineWrapping,
        fountainTheme,
        this.#plugin,
        activeElementField,
        autoUppercase,
        hoverSectionField,
        sectionAffordances({
          getParsed: (v) => v.plugin(this.#plugin)?.parsed || parseFountain(v.state.doc.toString()),
          canLink: () => { const s = this._store.store.activeScript(); return !!(s && s.final); },
          onAct: (act, sec) => this.#onSectionAct(act, sec),
        }),
        EditorView.domEventHandlers({
          mouseup: () => this.#deferSelectionGesture(),
          keyup: (e) => { if (e.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) this.#deferSelectionGesture(); },
          click: (e) => this.#onClick(e),
          paste: (e) => this.#onPaste(e),
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // Skip programmatic doc swaps we make to mirror the store (draft
          // switch / reconcile): those already match the store, so writing
          // back or remapping anchors off them would be wrong.
          if (this.#reconciling) return;
          const text = update.state.doc.toString();
          const remap = this.#remapAnchors(update);
          if (remap) {
            this._store.store.applyLiveEdit(this.#loadedScriptId, text, remap.boards, remap.links, remap.comments);
            // Recompute highlight decorations against the just-written anchors
            // now, instead of waiting out the debounced 'change' emit, so a
            // link the user is typing inside doesn't visibly blink out.
            queueMicrotask(() => this.#view && this.#view.dispatch({}));
          } else {
            this._store.store.updateScriptTextLive(this.#loadedScriptId, text);
          }
        }),
        EditorView.updateListener.of((update) => {
          // Report the element under the caret so the panel's element picker
          // (notes.md point 2) can show/track it as you move around.
          if (update.selectionSet || update.docChanged) this.#emitCaretElement();
        }),
      ],
    });
    this.#view = new EditorView({ state, parent: host, root: this.renderRoot });
    this.#emitCaretElement();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#connRAF);
    cancelAnimationFrame(this.#selRAF);
    this.#view?.destroy();
    super.disconnectedCallback();
  }

  // Only the final draft's anchors are ever shown as highlights (only the
  // final draft can own links), matching the original's
  // `sc.final ? R.biMap : {}`. A pending link-in-progress span ('hp') is
  // folded in by computeResolved() already, since that only ever runs
  // against the final script too.
  #getHighlights() {
    const store = this._store.store;
    const script = store.activeScript();
    if (!script || !script.final) return {};
    return store.getFinalState().R.biMap;
  }

  // CodeMirror finalizes a pointer/keyboard selection in its OWN mouseup /
  // key handling, which runs AFTER these domEventHandlers. Reading the
  // selection synchronously here therefore sometimes saw the pre-gesture
  // (often empty) selection, so the toolbar "sometimes didn't appear" (bug a).
  // Deferring one frame lets that selection land first, every time.
  #deferSelectionGesture() {
    cancelAnimationFrame(this.#selRAF);
    this.#selRAF = requestAnimationFrame(() => this.#onSelectionGesture());
  }

  #onSelectionGesture() {
    if (!this.#view) return;
    const sel = this.#view.state.selection.main;
    if (sel.empty) return;
    const store = this._store.store;
    const ui = store.ui;
    const script = store.activeScript();
    const parsed = this.#view.plugin(this.#plugin).parsed;
    const parts = captureFromSelection(parsed, this.#view.state.doc, sel.from, sel.to);
    if (!parts) return;

    const rect = this.#view.coordsAtPos(sel.head) || this.#view.coordsAtPos(sel.from);
    const anchorRect = rect ? { left: rect.left, right: rect.right, top: rect.bottom, bottom: rect.bottom, width: 0, height: 0 } : null;

    if (!script.final) {
      dispatch(this, 'pandemonium-show-selection-toolbar', { kind: 'non-final', parts, anchorRect, scriptId: script.id });
      return;
    }
    if (ui.linking && ui.linking.from === 'research') {
      store.addLink({ researchId: ui.linking.docId, sParts: parts, rParts: ui.linking.rParts });
      store.setUI({ linking: null });
      this.#view.dispatch({ selection: { anchor: sel.from } });
      dispatch(this, 'pandemonium-toast', { message: 'Linked.' });
      return;
    }
    if (ui.pendingRelink) { this.#completePendingRelink(parts); return; }
    dispatch(this, 'pandemonium-show-selection-toolbar', { kind: 'script', parts, anchorRect });
  }

  // Paste handler. MUST stay synchronous and return a boolean: CodeMirror
  // treats any truthy return from a domEventHandler as "I handled it, suppress
  // the default." An async function returns a Promise (always truthy), which
  // is exactly what was silently eating every TEXT paste. So: only claim the
  // event (return true) when there is actually an image to consume; otherwise
  // return false and let CodeMirror paste the text normally.
  #onPaste(e) {
    const file = imageFromClipboard(e.clipboardData);
    if (!file) return false;
    e.preventDefault();
    e.stopPropagation(); // claim it: pandemonium-app's document-level paste fallback skips this
    this.#pasteImage(file);
    return true;
  }

  // Pasting an image adds it as a storyboard image: attached to the current
  // selection if there is one (same result as picking "Board" from the
  // toolbar), otherwise added unattached (shows as "unlinked" in the Boards
  // panel, same as any board whose passage can't be found -- reattach it
  // to a passage whenever you like via that card's "Reattach" button).
  async #pasteImage(file) {
    const store = this._store.store;
    const script = store.activeScript();
    if (!script.final) {
      dispatch(this, 'pandemonium-toast', { message: 'Make this the final draft to add boards & research.' });
      return;
    }
    const sel = this.#view.state.selection.main;
    let parts = [];
    if (!sel.empty) {
      const parsed = this.#view.plugin(this.#plugin).parsed;
      parts = captureFromSelection(parsed, this.#view.state.doc, sel.from, sel.to) || [];
    }
    const img = await readFileAsDataURL(file);
    store.addBoard({ parts, img, caption: '' });
    dispatch(this, 'pandemonium-toast', { message: parts.length ? 'Board added.' : 'Board added. Select a script passage anytime to attach it.' });
  }

  // The section rail (cm-sections.js) fires these for a whole Fountain
  // section: the same two outcomes the free-text selection toolbar offers,
  // just anchored to the section's blocks instead of a hand-dragged span, so
  // the common "board/source this beat" case needs no precise selection.
  #onSectionAct(act, sec) {
    const store = this._store.store;
    if (act === 'board') {
      this.#pendingBoardParts = sec.parts;
      const input = this.renderRoot.getElementById('secFileImg');
      input.value = '';
      input.click();
      return;
    }
    if (act === 'source') {
      if (!store.project.research.length) { openSourceDialog(this, store, sec.parts, 'link'); return; }
      store.setUI({ linking: { from: 'script', parts: sec.parts }, openDoc: null });
      return;
    }
    if (act === 'comment') {
      const c = store.addComment({ parts: sec.parts });
      dispatch(this, 'pandemonium-show-comment', { commentId: c.id, anchorRect: this.#sectionRect(sec) });
    }
  }

  #sectionRect(sec) {
    const doc = this.#view.state.doc;
    if (sec.firstLine + 1 > doc.lines) return null;
    const c = this.#view.coordsAtPos(doc.line(sec.firstLine + 1).from);
    return c ? { left: c.left, right: c.right, top: c.top, bottom: c.bottom, width: 0, height: 0 } : null;
  }

  // Element picker (notes.md point 2). The current element is read straight
  // from the parser's block type at the caret; setting one rewrites the caret
  // line with the right Fountain forcing/markup (see element-ops.js). Public:
  // the script panel's picker calls setLineElement().
  #caretElementKey() {
    if (!this.#view) return 'action';
    const state = this.#view.state;
    const doc = state.doc;
    const line0 = doc.lineAt(state.selection.main.head).number - 1;
    // A pin (Tab, the picker, or the element Enter just moved you into) is
    // what the next keystroke will produce on this line, so the picker shows
    // that; without one, the parser's own verdict.
    const active = state.field(activeElementField, false);
    if (active && doc.lineAt(Math.min(active.pos, doc.length)).number - 1 === line0) return active.el;
    const parsed = this.#view.plugin(this.#plugin)?.parsed;
    const b = parsed && parsed.blocks.find((x) => x.line === line0);
    return elementOfBlock(b);
  }

  #emitCaretElement() {
    const key = this.#caretElementKey();
    if (key === this.#lastEmittedElement) return;
    this.#lastEmittedElement = key;
    dispatch(this, 'pandemonium-caret-element', { key });
  }

  setLineElement(key) {
    if (!this.#view) return;
    applyElementAtCaret(this.#view, key);
    this.#view.focus();
  }

  async #onSectionImage(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const img = await readFileAsDataURL(file);
    this._store.store.addBoard({ parts: this.#pendingBoardParts || [], img, caption: '' });
    this.#pendingBoardParts = null;
    dispatch(this, 'pandemonium-toast', { message: 'Board added.' });
  }

  #completePendingRelink(parts) {
    const store = this._store.store;
    const pr = store.ui.pendingRelink;
    store.setUI({ pendingRelink: null });
    if (pr.type === 'board') { store.reattachBoard(pr.id, parts); dispatch(this, 'pandemonium-toast', { message: 'Reattached.' }); return; }
    if (pr.type === 'link') { store.reattachLink(pr.id, parts); dispatch(this, 'pandemonium-toast', { message: 'Reattached.' }); }
  }

  // Bug #1: editing text inside a linked passage used to sever the link,
  // because anchors are stored as a quoted substring and the quote no longer
  // matched once you typed into it. Here, on every edit, we map each anchor's
  // OLD raw span through this transaction's changes, then re-derive its stored
  // {q, b, s} from the edited text at the mapped position -- so a link/board
  // follows the words you're editing instead of going "lost". Quote-based
  // storage is preserved (still what makes edits ELSEWHERE safe, per
  // resolve.js); this only refreshes the quote for the span you actually
  // touched. Runs only when the final draft (the sole owner of anchors) is the
  // document being edited. Returns {boards, links} (either may be null when
  // unchanged), or null when nothing needs rewriting.
  #remapAnchors(update) {
    const store = this._store.store;
    const project = store.project;
    const fsc = store.finalScript();
    if (!fsc || fsc.id !== this.#loadedScriptId) return null;
    if (!project.boards.length && !project.links.length && !(project.comments && project.comments.length)) return null;

    const prevDoc = update.startState.doc;
    const nextDoc = update.state.doc;
    const prev = parseFountain(prevDoc.toString());
    const next = this.#view.plugin(this.#plugin)?.parsed || parseFountain(nextDoc.toString());
    const changes = update.changes;
    const prevPlains = prev.blocks.map((b) => b.plain);
    const lineFrom = (doc, b) => (b.line + 1 <= doc.lines ? doc.line(b.line + 1).from : null);

    const remapPart = (pt) => {
      const r = resolvePart(prevPlains, pt);
      if (!r) return pt; // not locatable even before the edit -> leave untouched
      const pb = prev.blocks[r.bi];
      const pFrom = lineFrom(prevDoc, pb);
      if (pFrom == null) return pt;
      const nFrom = changes.mapPos(plainPosToRaw(pb, pFrom, r.s), 1);
      const nTo = changes.mapPos(plainPosToRaw(pb, pFrom, r.e), -1);
      if (nTo <= nFrom) return pt; // quoted span fully deleted -> keep old anchor (renders as lost)
      const nb = next.blocks.find((b) => {
        if (b.type === 'page') return false;
        const lf = lineFrom(nextDoc, b);
        if (lf == null) return false;
        const rng = blockRawRange(b, lf);
        return nFrom >= rng.from && nFrom <= rng.to;
      });
      if (!nb) return pt;
      const nlf = lineFrom(nextDoc, nb);
      const rng = blockRawRange(nb, nlf);
      const ps = rawOffsetToPlainPos(nb, nlf, Math.max(nFrom, rng.from), true);
      const pe = rawOffsetToPlainPos(nb, nlf, Math.min(nTo, rng.to), false);
      if (pe <= ps) return pt;
      const q = nb.plain.slice(ps, pe);
      if (!q.trim()) return pt;
      if (q === pt.q && nb.i === pt.b && ps === pt.s) return pt;
      return { q, b: nb.i, s: ps };
    };

    const remapAnchor = (anchor) => {
      const parts = (anchor && anchor.parts) || [];
      if (!parts.length) return null;
      let changed = false;
      const out = parts.map((pt) => { const np = remapPart(pt); if (np !== pt) changed = true; return np; });
      return changed ? { parts: out } : null;
    };

    let boardsChanged = false;
    const boards = project.boards.map((bd) => { const na = remapAnchor(bd.anchor); if (na) { boardsChanged = true; return { ...bd, anchor: na }; } return bd; });
    let linksChanged = false;
    const links = project.links.map((lk) => { const na = remapAnchor(lk.anchor); if (na) { linksChanged = true; return { ...lk, anchor: na }; } return lk; });
    let commentsChanged = false;
    const comments = (project.comments || []).map((cm) => { const na = remapAnchor(cm.anchor); if (na) { commentsChanged = true; return { ...cm, anchor: na }; } return cm; });

    if (!boardsChanged && !linksChanged && !commentsChanged) return null;
    return {
      boards: boardsChanged ? boards : null,
      links: linksChanged ? links : null,
      comments: commentsChanged ? comments : null,
    };
  }

  #onClick(e) {
    const mk = e.target.closest('[data-hl]');
    if (!mk) return;
    if (!this.#view.state.selection.main.empty) return;
    const toks = (mk.dataset.hl || '').split(/\s+/);
    const rTok = toks.find((t) => t.indexOf('r:') === 0);
    const bTok = toks.find((t) => t.indexOf('b:') === 0);
    const cTok = toks.find((t) => t.indexOf('c:') === 0);
    if (rTok) { openPair(this._store.store, rTok.slice(2)); e.preventDefault(); return; }
    if (bTok) { dispatch(this, 'pandemonium-show-board-popover', { boardId: bTok.slice(2), anchor: mk }); e.preventDefault(); return; }
    if (cTok) { dispatch(this, 'pandemonium-show-comment', { commentId: cTok.slice(2), anchorRect: mk.getBoundingClientRect() }); e.preventDefault(); }
  }

  #scrollToBlock(bi) {
    const parsed = this.#view.plugin(this.#plugin)?.parsed;
    if (!parsed) return;
    const b = parsed.blocks.find((x) => x.i === bi);
    if (!b || b.line == null) return;
    const doc = this.#view.state.doc;
    if (b.line + 1 > doc.lines) return;
    const line = doc.line(b.line + 1);
    this.#view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    requestAnimationFrame(() => {
      const lineEl = this.#view.domAtPos(line.from)?.node;
      const el = lineEl && lineEl.nodeType === 1 ? lineEl : lineEl?.parentElement;
      const target = el?.closest('.cm-line');
      if (!target) return;
      target.classList.add('hl-flash');
      setTimeout(() => target.classList.remove('hl-flash'), 900);
    });
  }

  // Replace the whole document to match the store, without letting the
  // updateListener treat it as a user edit (see #reconciling).
  #applyDocFromStore(text) {
    this.#reconciling = true;
    try {
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: text } });
    } finally {
      this.#reconciling = false;
    }
  }

  updated() {
    if (!this.#view) return;
    const store = this._store.store;
    const script = store.activeScript();
    if (!script) return;

    if (script.id !== this.#loadedScriptId) {
      this.#loadedScriptId = script.id;
      this.#applyDocFromStore(script.text);
    } else if (script.text !== this.#view.state.doc.toString()) {
      // Same draft, but the store's text moved out from under us: another
      // script panel showing this same draft edited it (duplicates are
      // allowed), or it changed via import/undo. Adopt it so the panels agree.
      this.#applyDocFromStore(script.text);
    }

    const ui = store.ui;

    // Bug b: a relink armed from elsewhere (a board card's Reattach, a lost
    // link's "reattach") while a passage is ALREADY selected here should just
    // use that selection, instead of leaving the "select the passage" prompt
    // up as if nothing is selected. A fresh in-editor selection is still
    // handled by #onSelectionGesture; this covers the already-selected case.
    if (ui.pendingRelink) {
      const sel = this.#view.state.selection.main;
      if (!sel.empty) {
        const parsed = this.#view.plugin(this.#plugin).parsed;
        const parts = captureFromSelection(parsed, this.#view.state.doc, sel.from, sel.to);
        if (parts) { this.#completePendingRelink(parts); return; }
      }
    }

    if (ui.scrollToBlock != null) {
      const bi = ui.scrollToBlock;
      store.setUI({ scrollToBlock: null });
      this.#scrollToBlock(bi);
    }

    // Force the decoration plugin to recompute even when nothing about
    // *this* editor's own doc/selection changed -- e.g. a board was
    // relinked from the Boards panel, or the debounced text-sync emit
    // landed -- both change what store.getFinalState().R.biMap returns
    // without CodeMirror itself having dispatched anything.
    this.#view.dispatch({});

    this.#syncConnector(ui);
  }

  #syncConnector(ui) {
    cancelAnimationFrame(this.#connRAF);
    if (!ui.pair) { this.#lastPulsed = null; dispatch(this, 'pandemonium-connector-point', { side: 'script', rect: null }); return; }
    if (ui.pair !== this.#lastPulsed) {
      this.#lastPulsed = ui.pair;
      const mark = this.renderRoot.querySelector(`[data-hl~="r:${ui.pair}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        mark.classList.add('hl-flash');
        setTimeout(() => mark.classList.remove('hl-flash'), 2100);
      }
    }
    const tick = () => {
      const mark = this.renderRoot.querySelector(`[data-hl~="r:${ui.pair}"]`);
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
    return html`
      <div class="host"></div>
      <input type="file" id="secFileImg" accept="image/*" style="display:none" @change=${(e) => this.#onSectionImage(e)}>
    `;
  }
}

customElements.define('pandemonium-script-editor', PandemoniumScriptEditor);

'use strict';

import { LitElement, html, css } from 'lit';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { fountainDecorations } from './cm-fountain-plugin.js';
import { sectionAffordances, hoverSectionField, pinnedSectionField, setPinnedSection } from './cm-sections.js';
import { fountainTheme } from './cm-theme.js';
import { fountainMinimap, minimapTheme, setMinimapMarks } from './cm-minimap.js';
import { boardLinkKinds, gutterRecord } from '../../state/selectors.js';
import { captureFromSelection } from './selection-capture.js';
import { openSourceDialog } from '../research/source-dialog.js';
import { parseFountain } from '../../fountain/parse.js';
import { resolvePart, snapToWords } from '../../fountain/resolve.js';
import { plainPosToRaw, rawOffsetToPlainPos, blockRawRange } from '../../fountain/doc-map.js';
import { elementOfBlock, ELEMENT_LABELS, ELEMENT_MENU } from '../../fountain/element-ops.js';
import { activeElementField, autoUppercase, applyElementAtCaret, elementKeymap } from './cm-autoformat.js';
import { caseJournal, caseExempt } from './cm-case-journal.js';
import { emphasisKeymap } from './cm-emphasis.js';
import { summaryDefault } from './cm-summary-default.js';
import { linkToItems } from '../linking/link-actions.js';
import { elementMenu } from './element-menu.js';
import { readFileAsDataURL, isBoardMediaFile, BOARD_MEDIA_ACCEPT } from '../../utils/files.js';
import { frameImg } from '../../data/project-model.js';
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
  // leafId identifies which pane this editor is, so it can show that pane's own
  // draft (per-pane draft selection, see store.scriptForLeaf).
  static properties = { leafId: {} };

  static styles = css`
    :host{display:block;height:100%}
    .host{height:100%}
    :host(.editing) {} /* legacy hook retained for parent panel styling if needed */
  `;

  #view = null;
  #plugin = null;
  #lastMarksKey = null;
  #loadedScriptId = null;
  #connRAF = 0;
  #selRAF = 0;
  #lastPulsed = null;
  #pendingBoardParts = null;
  #reconciling = false;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  firstUpdated() {
    const host = this.renderRoot.querySelector('.host');
    this.#plugin = fountainDecorations((parsed) => this.#getHighlights(parsed));
    const script = this._store.store.scriptForLeaf(this.leafId);
    this.#loadedScriptId = script.id;
    const state = EditorState.create({
      doc: script.text,
      extensions: [
        history(),
        // Before the element keymap: while the element menu is open it owns
        // Enter and the letter keys (element-menu.js sets its own precedence).
        elementMenu({ onPick: (view, key) => applyElementAtCaret(view, key) }),
        elementKeymap({ getParsed: (v) => v.plugin(this.#plugin)?.parsed || parseFountain(v.state.doc.toString()) }),
        emphasisKeymap({ getParsed: (v) => v.plugin(this.#plugin)?.parsed || parseFountain(v.state.doc.toString()) }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Shown only while the document is empty, so it appears on a new
        // draft, goes on the first keystroke, and comes back if the writer
        // clears everything out again. CodeMirror owns that toggle. Styled as
        // a synopsis (cm-theme.js .cm-placeholder) because that is genuinely
        // what the first keystroke becomes -- see cm-summary-default.js.
        placeholder('Start with a summary of the script'),
        EditorView.lineWrapping,
        fountainTheme,
        fountainMinimap,
        minimapTheme,
        this.#plugin,
        activeElementField,
        // Both fields belong to the element flow: the journal records what a
        // transform overwrote so Shift+Tab can give it back, and the exemption
        // is what stops autoUppercase from immediately undoing that.
        caseJournal,
        caseExempt,
        // Before autoUppercase: a blank script's first keystroke becomes a
        // Summary (Fountain synopsis) instead of Action (see cm-summary-default).
        summaryDefault,
        autoUppercase,
        hoverSectionField,
        pinnedSectionField,
        sectionAffordances({
          getParsed: (v) => v.plugin(this.#plugin)?.parsed || parseFountain(v.state.doc.toString()),
          canLink: () => { const s = this._store.store.scriptForLeaf(this.leafId); return !!(s && s.final); },
          onAct: (act, sec, rect) => this.#onSectionAct(act, sec, rect),
          onLink: (sec, rect) => this.#openLinkMenu(sec, rect),
          onElement: (sec, rect) => this.#openElementMenu(sec, rect),
          onDropImage: (sec, file) => this.#dropImageOnSection(sec, file),
          elementLabelForSection: (sec) => this.#sectionElementLabel(sec),
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
      ],
    });
    this.#view = new EditorView({ state, parent: host, root: this.renderRoot });
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
    const script = store.scriptForLeaf(this.leafId);
    if (!script || !script.final) return {};
    return store.getFinalState().R.biMap;
  }

  // The minimap's gutter marks: a bar beside every line a storyboard link
  // lands on, green for a final board and yellow for a reference one. Only the
  // final draft owns links, so any other draft gets none. Colors are read off
  // the DOM (the gutter is a canvas, where var() does not resolve). Returns
  // the new {line: color} record, or null when it is unchanged since last time
  // so an unrelated store update does not repaint the minimap.
  #minimapMarks() {
    const store = this._store.store;
    const script = store.scriptForLeaf(this.leafId);
    let rec = {};
    if (script && script.final) {
      const state = store.getFinalState();
      const cs = getComputedStyle(this);
      const colors = { final: cs.getPropertyValue('--board-strong').trim(), ref: cs.getPropertyValue('--act').trim() };
      rec = gutterRecord(state.fparsed.blocks, boardLinkKinds(state.R.boards), colors);
    }
    const key = JSON.stringify(rec);
    if (key === this.#lastMarksKey) return null;
    this.#lastMarksKey = key;
    return rec;
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
    const script = store.scriptForLeaf(this.leafId);
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
    const script = store.scriptForLeaf(this.leafId);
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
    // Pasted images always go in the reference frame (see the same note in
    // pandemonium-app.js's document-level paste fallback). placeFrame fills the
    // reference frame of a storyboard already on this passage if it has one
    // empty, so the beat keeps a single storyboard.
    store.placeFrame({ parts, img, caption: '', mode: 'reference' });
    dispatch(this, 'pandemonium-toast', { message: parts.length ? 'Reference image added.' : 'Reference image added. Select a script passage anytime to attach it.' });
  }

  // The section rail (cm-sections.js) fires these for a whole Fountain
  // section: the same two outcomes the free-text selection toolbar offers,
  // just anchored to the section's blocks instead of a hand-dragged span, so
  // the common "board/source this beat" case needs no precise selection.
  #onSectionAct(act, sec, rect) {
    const store = this._store.store;
    if (act === 'board') {
      // Choosing Storyboard opens the boards panel if it is closed, so the
      // board the user is about to add has somewhere visible to land.
      store.revealContent('boards');
      this.#pendingBoardParts = this.#boardParts(sec);
      const input = this.renderRoot.getElementById('secFileImg');
      input.value = '';
      input.click();
      return;
    }
    if (act === 'blank') { this.#blankStoryboard(this.#boardParts(sec)); return; }
    if (act === 'source') {
      if (!store.project.research.length) { openSourceDialog(this, store, sec.parts, 'link'); return; }
      store.setUI({ linking: { from: 'script', parts: sec.parts }, openDoc: null });
      return;
    }
    if (act === 'comment') {
      const c = store.addComment({ parts: sec.parts });
      dispatch(this, 'pandemonium-show-comment', { commentId: c.id, anchorRect: rect || this.#sectionRect(sec) });
    }
  }

  // A storyboard with no image in either frame, on this passage: the beat is
  // claimed before there is anything to put there. It shows in both the Final
  // and Reference views, can carry a note, and takes an image in either frame
  // later. The boards panel is revealed and flashes it so it is not invisible.
  #blankStoryboard(parts) {
    const store = this._store.store;
    store.revealContent('boards');
    const board = store.addBlankBoard({ parts });
    store.setUI({ highlightBoard: board.id, highlightMode: 'final' });
    dispatch(this, 'pandemonium-toast', { message: 'Blank storyboard added. Give it a note, or drop an image on either frame.' });
  }

  // The "link to" pill's menu (Figma node 86-632): Storyboard, Blank
  // storyboard, Research, Sound.
  // Storyboard and Research route into the same section actions the rail used to
  // trigger directly; Sound is a planned link kind with no backing model yet, so
  // it says so rather than pretending. Colored to the app's link palette
  // (storyboard green, research pink) so the menu reads as the same three things
  // the script highlights already use.
  #openLinkMenu(sec, rect) {
    this.#pinHoverForMenu();
    const items = linkToItems({
      onStoryboard: () => this.#onSectionAct('board', sec),
      onBlankStoryboard: () => this.#onSectionAct('blank', sec),
      onResearch: () => this.#onSectionAct('source', sec),
      onSound: () => dispatch(this, 'pandemonium-toast', { message: 'Sound linking is coming soon.' }),
    });
    dispatch(this, 'pandemonium-open-menu', { x: rect.left, y: rect.bottom + 4, items, variant: 'pills' });
  }

  // Keep the hovered section lit and its rail visible while a rail menu is open,
  // even though reaching the menu takes the pointer off the row (item 3). The
  // pin is released on the next click anywhere -- choosing an item or dismissing
  // the menu both land as a click, and pd-menu closes itself on that same event.
  #pinHoverForMenu() {
    const idx = this.#view.state.field(hoverSectionField);
    if (idx < 0) return;
    this.#view.dispatch({ effects: setPinnedSection.of(idx) });
    const clear = () => { if (this.#view) this.#view.dispatch({ effects: setPinnedSection.of(-1) }); };
    document.addEventListener('mousedown', clear, { once: true, capture: true });
  }

  // The element type of a hovered section's first line, for the rail's element
  // pill label. Read from the parser (or a pin at that line) via the same
  // caretElementFor path the picker uses, so the rail never disagrees with it.
  #sectionElementLabel(sec) {
    const parsed = this.#view?.plugin(this.#plugin)?.parsed;
    const b = parsed && parsed.blocks.find((x) => x.line === sec.firstLine);
    return ELEMENT_LABELS[elementOfBlock(b)] || 'Element';
  }

  // Item 6: change the current line's screenplay element straight from the row
  // hover, the same set the panel header dropdown offers. Applies to the
  // section's first line; the caret is moved there so applyElementAtCaret (the
  // one entry point for "make this line an <x>") stays the single code path.
  #openElementMenu(sec, rect) {
    const doc = this.#view.state.doc;
    if (sec.firstLine + 1 > doc.lines) return;
    this.#pinHoverForMenu();
    const from = doc.line(sec.firstLine + 1).from;
    const current = this.#sectionElementLabel(sec);
    const items = ELEMENT_MENU.map((k) => ({
      label: ELEMENT_LABELS[k],
      selected: ELEMENT_LABELS[k] === current,
      fn: () => {
        this.#view.dispatch({ selection: { anchor: from } });
        applyElementAtCaret(this.#view, k);
        this.#view.focus();
      },
    }));
    dispatch(this, 'pandemonium-open-menu', { x: rect.left, y: rect.bottom + 4, items });
  }

  // Board anchors pair a cue with its speech: boarding a character cue also
  // covers its dialogue run, and boarding a speech also covers the cue above
  // it, so a storyboard frame is always tied to who is speaking. Only for
  // boards -- research and comments anchor to exactly what was chosen.
  #boardParts(sec) {
    const parsed = this.#view?.plugin(this.#plugin)?.parsed;
    if (!parsed || (sec.kind !== 'character' && sec.kind !== 'dialogue')) return sec.parts;
    const byI = new Map(parsed.blocks.map((b) => [b.i, b]));
    const wanted = new Set(sec.parts.map((p) => p.b));
    const isSpeech = (b) => b && (b.type === 'dialogue' || b.type === 'paren');
    if (sec.kind === 'character') {
      let j = Math.min(...wanted) + 1; // blocks are consecutive non-blank lines
      while (isSpeech(byI.get(j))) { wanted.add(j); j++; }
    } else {
      let j = Math.min(...wanted) - 1;
      while (isSpeech(byI.get(j))) j--; // back over the speech run
      if (byI.get(j) && byI.get(j).type === 'character') wanted.add(j);
    }
    return [...wanted].sort((a, b) => a - b).map((i) => { const b = byI.get(i); return { q: b.plain, b: b.i, s: 0 }; });
  }

  // Dropping an image onto a paragraph boards it. External drops (from outside
  // the storyboard panel) go in the REFERENCE frame by default (see
  // dropToReference, set under File > Storyboard settings). The image goes in
  // that frame of a storyboard already on this passage if it is empty (so the
  // beat keeps ONE storyboard with both frames); if every storyboard on the
  // passage already has that frame filled, the first is replaced after a
  // confirm. With no storyboard there at all, a new one is made (with cue/
  // dialogue pairing, see #boardParts) and its other frame starts empty. Either
  // way the boards panel is revealed and switched to the frame that changed,
  // scrolled to and flashed, so the drop is never invisible.
  async #dropImageOnSection(sec, file) {
    const store = this._store.store;
    store.revealContent('boards');
    const parts = this.#boardParts(sec);
    const firstBlock = parts[0] && parts[0].b;
    const mode = store.project.dropToReference !== false ? 'reference' : 'final';
    const here = store.getFinalState().R.boards.filter((o) => o.ok && o.firstBi === firstBlock);
    const img = await readFileAsDataURL(file);
    const filled = here.find((o) => frameImg(o.bd, mode));
    if (filled && here.every((o) => frameImg(o.bd, mode))) {
      dispatch(this, 'pandemonium-open-dialog', {
        title: 'Replace storyboard frame?',
        body: html`<p>This passage already has a ${mode} frame. Replace its image with the one you dropped?</p>`,
        okLabel: 'Replace',
        onOk: () => {
          store.replaceBoardImage(filled.bd.id, img, mode);
          store.setUI({ highlightBoard: filled.bd.id, highlightMode: mode });
          dispatch(this, 'pandemonium-toast', { message: 'Frame replaced.' });
        },
      });
      return;
    }
    const board = store.placeFrame({ parts, img, caption: '', mode });
    store.setUI({ highlightBoard: board.id, highlightMode: mode });
    dispatch(this, 'pandemonium-toast', { message: `Added to the ${mode} frame.` });
  }

  #sectionRect(sec) {
    const doc = this.#view.state.doc;
    if (sec.firstLine + 1 > doc.lines) return null;
    const c = this.#view.coordsAtPos(doc.line(sec.firstLine + 1).from);
    return c ? { left: c.left, right: c.right, top: c.top, bottom: c.bottom, width: 0, height: 0 } : null;
  }

  // Several images at once, because several boards can attach to one section
  // now. They keep the order they were picked in, which is what their `seq`
  // records.
  async #onSectionImage(e) {
    const files = [...(e.target.files || [])].filter(isBoardMediaFile);
    e.target.value = '';
    const parts = this.#pendingBoardParts || [];
    this.#pendingBoardParts = null;
    if (!files.length) return;
    // Final frames: "Storyboard" from the link menu is the deliberate "this
    // is the frame" action. The first fills an empty final frame already on
    // the section (say a blank storyboard, or one made from a reference
    // image); each further file starts its own storyboard.
    for (const file of files) {
      this._store.store.placeFrame({ parts, img: await readFileAsDataURL(file), caption: '', mode: 'final' });
    }
    dispatch(this, 'pandemonium-toast', {
      message: files.length === 1 ? 'Storyboard added.' : files.length + ' storyboards added to this section.',
    });
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
      let ps = rawOffsetToPlainPos(nb, nlf, Math.max(nFrom, rng.from), true);
      let pe = rawOffsetToPlainPos(nb, nlf, Math.min(nTo, rng.to), false);
      if (pe <= ps) return pt;
      // Keep the re-derived anchor on whole-word bounds, same as a fresh
      // capture, so editing a word the anchor already covers (typing inside
      // it, extending it) doesn't leave the boundary sitting mid-word.
      ({ s: ps, e: pe } = snapToWords(nb.plain, ps, pe));
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
    const script = store.scriptForLeaf(this.leafId);
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
    // without CodeMirror itself having dispatched anything. The minimap
    // gutter marks ride the same dispatch when they changed.
    const marks = this.#minimapMarks();
    this.#view.dispatch(marks ? { effects: setMinimapMarks.of(marks) } : {});

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
      <input type="file" id="secFileImg" accept=${BOARD_MEDIA_ACCEPT} multiple style="display:none" @change=${(e) => this.#onSectionImage(e)}>
    `;
  }
}

customElements.define('pandemonium-script-editor', PandemoniumScriptEditor);

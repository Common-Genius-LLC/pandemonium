// The CodeMirror ViewPlugin that makes the raw Fountain text LOOK like a
// formatted screenplay while it's being edited, and that renders board/
// research/comment highlight marks -- all computed purely from parseFountain()
// plus the doc-map position metadata, never a second grammar. Pure overlay: it
// never touches the document text, so Fountain round-trip fidelity is never at
// risk.
//
// It also does the Obsidian-style live preview: the Fountain syntax that marks
// an element (`.`/`@`/`>`/`#`/`=`/`~`, `> <` centering, `**`/`*`/`_` emphasis,
// `[[ ]]` notes) is HIDDEN on lines the caret isn't on -- so `### Title` reads
// as a formatted "Title" -- and merely DIMMED (`.cmf-syntax`) on the line being
// edited, so entering a line reveals its source. Whether a line is "being
// edited" is just whether any selection range touches it, so this recomputes on
// every selection change, not only edits.
'use strict';

import { ViewPlugin, Decoration } from '@codemirror/view';
import { parseFountain, isCharacterCueText } from '../../fountain/parse.js';
import { plainRangeToRaw, inlineDelimRanges } from '../../fountain/doc-map.js';
import { activeElementField, pinOverridesParser } from './cm-autoformat.js';

const LINE_CLASS = {
  scene: 'cmf-scene', action: 'cmf-action', character: 'cmf-character', paren: 'cmf-paren',
  dialogue: 'cmf-dialogue', transition: 'cmf-transition', centered: 'cmf-centered',
  lyric: 'cmf-lyric', section: 'cmf-section', synopsis: 'cmf-synopsis',
};

function runStyle(r) {
  let c = '';
  if (r.b) c += ' cmf-b';
  if (r.i) c += ' cmf-i';
  if (r.u) c += ' cmf-u';
  if (r.n) c += ' cmf-note';
  return c.trim();
}

// Same overlap coalescing blockHTML() does: a board+research overlap gets both
// classes and both ids on one span.
function coalesceHighlights(n, hls) {
  if (!hls || !hls.length) return [];
  const idsArr = new Array(n).fill(null);
  for (const h of hls) {
    for (let k = Math.max(0, h.s); k < Math.min(n, h.e); k++) { (idsArr[k] = idsArr[k] || []).push(h); }
  }
  const keyAt = (k) => (idsArr[k] ? idsArr[k].map((h) => h.kind + ':' + h.id).join(',') : '');
  const out = [];
  let segStart = 0, curKey = keyAt(0);
  for (let k = 1; k <= n; k++) {
    const kk = k < n ? keyAt(k) : null;
    if (kk !== curKey) {
      if (curKey) {
        const list = idsArr[segStart];
        out.push({ s: segStart, e: k, cls: [...new Set(list.map((h) => h.cls))].join(' '), idAttr: list.map((h) => h.kind + ':' + h.id).join(' ') });
      }
      segStart = k; curKey = kk;
    }
  }
  return out;
}

// Set of 0-based line numbers any selection range touches -- the lines shown in
// "source" (dimmed-syntax) mode rather than preview.
function activeLineSet(state) {
  const set = new Set();
  const doc = state.doc;
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number, b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n - 1);
  }
  return set;
}

function rawLineBlank(doc, n) { return n < 1 || n > doc.lines || doc.line(n).text.trim() === ''; }

// Real Fountain only recognises a character cue once a non-blank line
// follows it (parseFountain.js), which is correct for a saved file but means
// the instant you press Enter after typing one, the still-empty line you
// land on makes the parser re-read the cue as plain action -- both lines
// flash to action formatting until you type the first word of dialogue. This
// keeps the cue (and its still-blank dialogue line) previewing correctly for
// as long as the caret sits on that blank line, regardless of whether the
// element was set by typing caps directly or via Tab/the element picker.
function isPendingCharacterCue(doc, b, activeLines) {
  if (b.type !== 'action') return false;
  const nextLineNo = b.line + 2; // 1-based number of the raw line right after b
  if (!rawLineBlank(doc, nextLineNo) || !activeLines.has(nextLineNo - 1)) return false;
  if (!rawLineBlank(doc, b.line)) return false; // b.line (1-based) is the line before b's own
  return isCharacterCueText(b.text);
}

// Pure builder (takes an EditorState, not a view) so it's unit-testable without
// spinning up an editor. `parsed` is parseFountain(doc); `highlights` is the
// biMap of board/research/comment anchors.
export function buildDecorations(state, parsed, highlights) {
  const doc = state.doc;
  highlights = highlights || {};
  const activeLines = activeLineSet(state);
  const active = state.field(activeElementField, false);
  const pinLine = active ? doc.lineAt(Math.min(active.pos, doc.length)).number - 1 : -1;
  const decos = [];
  const conceal = (from, to, isActive) => {
    if (to <= from) return;
    decos.push((isActive ? Decoration.mark({ class: 'cmf-syntax' }) : Decoration.replace({})).range(from, to));
  };

  // Blank lines never carry a parsed block (parseFountain skips them), so any
  // preview class for a still-empty line -- a Tab/picker pin, or a character
  // cue's not-yet-typed dialogue line (isPendingCharacterCue) -- is recorded
  // here instead of decorated immediately. CodeMirror concatenates the class
  // strings of every Decoration.line that targets the same line, so pushing
  // from two sources independently can silently stack two element classes
  // (e.g. cmf-scene + cmf-dialogue) onto one line, and whichever is declared
  // later in cm-theme.js wins the cascade on any property they both set --
  // that's how a scene heading picked up centered dialogue text-align in the
  // past. Collecting candidates in a map first guarantees exactly one class
  // per blank line: a real pin (an explicit, current user action) always
  // wins over the inferred cue preview.
  const blankLineClass = new Map();
  if (active && pinLine >= 0 && activeLines.has(pinLine) && LINE_CLASS[active.el]) {
    const l = doc.line(pinLine + 1);
    if (l.length === 0) blankLineClass.set(l.from, LINE_CLASS[active.el]);
  }

  for (const b of parsed.blocks) {
    if (b.type === 'page' || b.line == null || b.line + 1 > doc.lines) continue;
    const line = doc.line(b.line + 1);
    const isActive = activeLines.has(b.line);
    // While the caret is on a line with a pinned element (Tab / picker), show
    // that element's formatting even if the parser doesn't agree yet -- so a
    // character cue centers while you type it, before its dialogue exists.
    // Only for the elements the parser genuinely cannot judge from the line
    // alone (pinOverridesParser); otherwise the parser wins on a line that has
    // text, so nothing is styled as an element the file does not contain and
    // then silently reflows the moment the caret leaves.
    const pinned = active && isActive && b.line === pinLine && pinOverridesParser(active.el) && LINE_CLASS[active.el];
    const pendingCue = !pinned && isPendingCharacterCue(doc, b, activeLines);
    const cls = pinned || (pendingCue ? LINE_CLASS.character : LINE_CLASS[b.type]);
    if (cls) decos.push(Decoration.line({ class: cls }).range(line.from));
    if (pendingCue) {
      const nextLine = doc.line(b.line + 2);
      if (!blankLineClass.has(nextLine.from)) blankLineClass.set(nextLine.from, LINE_CLASS.dialogue);
    }

    // Element markers: leading (`.`/`@`/`#`/`= `/`> ` ...) and, for a centered
    // line, the trailing ` <`.
    if (b.textOffset > 0) conceal(line.from, line.from + b.textOffset, isActive);
    if (b.type === 'centered') conceal(line.from + b.textOffset + b.text.length, line.to, isActive);

    // Inline emphasis: style the plain runs, hide/dim their delimiters.
    const base = line.from + b.textOffset;
    for (const r of b.runs) {
      const sc = runStyle(r);
      if (sc && r.map.length) {
        const from = base + r.map[0], to = base + r.map[r.map.length - 1] + 1;
        if (to > from) decos.push(Decoration.mark({ class: sc }).range(from, to));
      }
    }
    for (const [ds, de] of inlineDelimRanges(b)) conceal(base + ds, base + de, isActive);

    // Board / research / comment highlights.
    const marks = coalesceHighlights(b.plain.length, highlights[b.i]);
    for (const m of marks) {
      const { from, to } = plainRangeToRaw(b, line.from, m.s, m.e);
      if (to > from) decos.push(Decoration.mark({ class: m.cls, attributes: { 'data-hl': m.idAttr } }).range(from, to));
    }
  }

  for (const [from, cls] of blankLineClass) decos.push(Decoration.line({ class: cls }).range(from));

  return Decoration.set(decos, true);
}

export function fountainDecorations(getHighlights) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.parsed = parseFountain(view.state.doc.toString());
      this.decorations = buildDecorations(view.state, this.parsed, getHighlights(this.parsed));
    }

    update(update) {
      if (update.docChanged) this.parsed = parseFountain(update.state.doc.toString());
      // Rebuild on selection changes too: the conceal/reveal depends on which
      // line the caret is on, not just on the text.
      this.decorations = buildDecorations(update.view.state, this.parsed, getHighlights(this.parsed));
    }
  }, { decorations: (v) => v.decorations });
}

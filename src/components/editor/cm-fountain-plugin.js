// The CodeMirror ViewPlugin that makes the raw Fountain text LOOK like a
// formatted screenplay while it's being edited, and that renders board/
// research highlight marks -- both computed purely from parseFountain()'s
// output plus the doc-map position metadata, never a second grammar. This
// is a pure overlay: it never touches the document text itself, so Fountain
// round-trip fidelity is never at risk (CodeMirror is always editing the
// real, unmodified source).
'use strict';

import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { parseFountain } from '../../fountain/parse.js';
import { plainRangeToRaw } from '../../fountain/doc-map.js';

const LINE_CLASS = {
  scene: 'cmf-scene', action: 'cmf-action', character: 'cmf-character', paren: 'cmf-paren',
  dialogue: 'cmf-dialogue', transition: 'cmf-transition', centered: 'cmf-centered',
  lyric: 'cmf-lyric', section: 'cmf-section', synopsis: 'cmf-synopsis',
};

// Merges overlapping highlight entries the same way blockHTML() does (a
// board+research overlap gets both classes and both ids on one span), just
// without the bold/italic run bookkeeping blockHTML also carries -- inline
// emphasis is intentionally left as plain visible text for now (see the
// module doc in decorated editor for why: hiding delimiter characters is
// the riskier, not-yet-attempted feature).
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

// `getHighlights(parsed)` returns {[blockIndex]: [{s,e,cls,id,kind}]}, the
// same shape as store.getFinalState().R.biMap. Returns the ViewPlugin
// extension; pass the SAME reference to `view.plugin(ref)` later to read
// back the plugin's current `.parsed` (e.g. for selection capture) without
// re-parsing.
export function fountainDecorations(getHighlights) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.parsed = parseFountain(view.state.doc.toString());
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.docChanged) this.parsed = parseFountain(update.state.doc.toString());
      this.decorations = this.build(update.view);
    }

    build(view) {
      const builder = new RangeSetBuilder();
      const doc = view.state.doc;
      const highlights = getHighlights(this.parsed) || {};
      for (const b of this.parsed.blocks) {
        if (b.type === 'page' || b.line == null || b.line + 1 > doc.lines) continue;
        const line = doc.line(b.line + 1);
        const cls = LINE_CLASS[b.type];
        if (cls) builder.add(line.from, line.from, Decoration.line({ class: cls }));
        const marks = coalesceHighlights(b.plain.length, highlights[b.i]);
        for (const m of marks) {
          const { from, to } = plainRangeToRaw(b, line.from, m.s, m.e);
          if (to > from) builder.add(from, to, Decoration.mark({ class: m.cls, attributes: { 'data-hl': m.idAttr } }));
        }
      }
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

// Real pages in the script editor: the document laid out on sheets of A4 or
// Letter at the standard 12pt screenplay grid, with page numbers, instead of
// one endless column.
//
// Two parts, because CodeMirror only allows vertical layout changes from
// state, never from a view plugin:
//
//   pagesField  a StateField that lays the document out (fountain/paginate.js)
//               and turns every page break into a block widget exactly as tall
//               as the rest of the page it ends, plus the bottom and top
//               margins and the gap between sheets. The widget carries the
//               next page's number.
//   pageSheets  a background layer that draws each sheet behind the text,
//               each anchored to where CodeMirror places that page's first
//               line (see markers), so text and sheet can never disagree.
//
// Geometry comes in by effect (setPageMetrics): paper, pixels per inch (the
// text-size preference times any fit-to-pane shrink) and the gap. Changing
// the pixels per inch rescales the page but never moves a break, because the
// layout is in characters and rows.
'use strict';

import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, layer, RectangleMarker } from '@codemirror/view';
import { parseText } from '../../fountain/cache.js';
import { pageGrid, lineTypes, paginate, MARGINS, LPI } from '../../fountain/paginate.js';

export const setPageMetrics = StateEffect.define();

const DEFAULT_METRICS = { paper: 'a4', ppi: 96, gap: 12 };

const metricsField = StateField.define({
  create: () => DEFAULT_METRICS,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPageMetrics)) return { ...value, ...e.value };
    return value;
  },
});

// The space between two pages: the rest of the page that ended, its bottom
// margin, the desk between the sheets, and the next page's top margin, with
// that page's number set in its top margin as a screenplay prints it.
class PageGap extends WidgetType {
  constructor(height, numberTop, label) {
    super();
    this.height = height;
    this.numberTop = numberTop;
    this.label = label;
  }
  eq(o) { return o.height === this.height && o.numberTop === this.numberTop && o.label === this.label; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-page-gap';
    el.style.height = this.height + 'px';
    el.setAttribute('aria-hidden', 'true');
    if (this.label) {
      const n = document.createElement('span');
      n.className = 'cm-page-num';
      n.textContent = this.label;
      n.style.top = this.numberTop + 'px';
      el.appendChild(n);
    }
    return el;
  }
  get estimatedHeight() { return this.height; }
  ignoreEvent() { return true; }
}

function compute(state) {
  const m = state.field(metricsField);
  const text = state.doc.toString();
  const lines = text.split('\n');
  const grid = pageGrid(m.paper);
  const { paper, rows } = grid;
  // The page may be narrower than the paper (a narrow pane, see pageFit): its
  // own column count and margins arrive with the metrics.
  const cols = m.cols || grid.cols;
  const layout = paginate({ lines, types: lineTypes(parseText(text), lines.length, lines), cols, rows, refCols: m.refCols || grid.cols });

  const lh = m.ppi / LPI;
  const top = MARGINS.top * m.ppi;
  const pageH = paper.height * m.ppi;
  // The bottom margin takes up the part of a row the grid cannot use, so a
  // sheet is exactly the paper's height.
  const bottom = pageH - top - rows * lh;
  const geom = { ppi: m.ppi, lh, top, bottom, pageH, pageW: m.pageW || paper.width * m.ppi, left: m.left != null ? m.left : MARGINS.left * m.ppi, gap: m.gap, count: layout.pages.length };

  const b = new RangeSetBuilder();
  for (let p = 1; p < layout.pages.length; p++) {
    const prev = layout.pages[p - 1];
    const page = layout.pages[p];
    const fill = Math.max(0, rows - prev.used) * lh;
    const toNextTop = fill + bottom + m.gap;
    const pos = state.doc.line(Math.min(page.start + 1, state.doc.lines)).from;
    const label = page.shown ? page.number + '.' : '';
    // The number sits half an inch below the top of its page.
    b.add(pos, pos, Decoration.widget({ widget: new PageGap(toNextTop + top, toNextTop + 0.5 * m.ppi - lh * 0.8, label), block: true, side: -1 }));
  }
  const last = layout.pages[layout.pages.length - 1];
  const end = state.doc.length;
  b.add(end, end, Decoration.widget({ widget: new PageGap(Math.max(0, rows - last.used) * lh + bottom, 0, ''), block: true, side: 1 }));
  return { layout, geom, decorations: b.finish() };
}

export const pagesField = StateField.define({
  create: (state) => compute(state),
  update(value, tr) {
    if (!tr.docChanged && !tr.effects.some((e) => e.is(setPageMetrics))) return value;
    return compute(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

// Where the sheets go. Coordinates are relative to the scroller's content,
// the same base CodeMirror's own selection layer uses.
const pageSheets = layer({
  above: false,
  class: 'cm-page-layer',
  update(update) {
    return update.docChanged || update.geometryChanged || update.viewportChanged
      || update.transactions.some((tr) => tr.effects.some((e) => e.is(setPageMetrics)));
  },
  markers(view) {
    const { geom, layout } = view.state.field(pagesField);
    const doc = view.state.doc;
    const sc = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const left = content.left - (sc.left - view.scrollDOM.scrollLeft);
    // Where the document starts, in the scroller's own content coordinates.
    const docTop = view.documentTop - (sc.top - view.scrollDOM.scrollTop);
    const out = [];
    for (let k = 0; k < geom.count; k++) {
      // Each sheet hangs off where CodeMirror ITSELF says the page's first line
      // is, not off an ideal grid. A line CodeMirror has not rendered yet has
      // only an estimated height (it ignores word wrap and our narrower
      // dialogue columns), so its text sits a few rows off where the grid says
      // by the time you are several pages down; the sheets, drawn from the
      // grid, then no longer lined up with the text they hold. Taken from the
      // same height map as the text, they always are, and correct themselves
      // as the estimates are replaced by measurements.
      const from = doc.line(Math.min(layout.pages[k].start + 1, doc.lines)).from;
      const block = view.lineBlockAt(from);
      const text = Array.isArray(block.type) ? block.type[block.type.length - 1] : block;
      out.push(new RectangleMarker('cm-page-sheet', left, docTop + text.top - geom.top, geom.pageW, geom.pageH));
    }
    return out;
  },
});

export const scriptPages = [metricsField, pagesField, pageSheets];

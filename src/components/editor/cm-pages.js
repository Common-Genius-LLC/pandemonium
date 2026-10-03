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
import { EditorView, Decoration, WidgetType, layer, RectangleMarker, BlockType } from '@codemirror/view';
import { parseText } from '../../fountain/cache.js';
import { pageGrid, lineTypes, paginate, displayLines, MARGINS, LPI } from '../../fountain/paginate.js';

export const setPageMetrics = StateEffect.define();

// The desk between two sheets. It was 12px, the gap of a stack of pages; it is
// 40px because the Add page pill (cm-add-page.js) sits in that gap, below the
// page it belongs to, and 12px is not room for a control.
const DEFAULT_METRICS = { paper: 'a4', ppi: 96, gap: 40 };

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
  // false, so CodeMirror handles a click here itself and puts the caret on the
  // nearest line. Returning true (the WidgetType default) meant a press
  // anywhere in a page margin -- including the whole unused bottom of the last
  // page, which is often most of the pane -- reached nothing: the click did
  // nothing at all, and the browser was left to put a native caret beside an
  // uneditable block, which it drew as tall as the block.
  ignoreEvent() { return false; }
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
  const parsed = parseText(text);
  const layout = paginate({
    lines,
    types: lineTypes(parsed, lines.length, lines),
    display: displayLines(parsed, lines),
    cols,
    rows,
    refCols: m.refCols || grid.cols,
  });

  const lh = m.ppi / LPI;
  const top = MARGINS.top * m.ppi;
  const pageH = paper.height * m.ppi;
  // The bottom margin takes up the part of a row the grid cannot use, so a
  // sheet is exactly the paper's height.
  const bottom = pageH - top - rows * lh;
  const geom = { ppi: m.ppi, lh, top, bottom, pageH, pageW: m.pageW || paper.width * m.ppi, left: m.left != null ? m.left : MARGINS.left * m.ppi, cols, gap: m.gap, count: layout.pages.length };

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

// The BlockInfo of the TEXT of a line, never a block widget that shares that
// line. CodeMirror hands back a composite whose `type` is the array of blocks
// making up the line, in document order, so a page-break widget shows up
// before its line and the end-of-document page filler shows up after the last
// one. Taking the last entry (what this used to do) therefore picked the
// FILLER on the final page, and the sheet was drawn as far below its own text
// as that page had rows left: the last page's text sat above its sheet, and a
// page's worth of empty desk opened under it. That is the "text comes out of
// the page" the writer was looking at.
export function textBlockAt(view, pos) {
  const block = view.lineBlockAt(pos);
  if (!Array.isArray(block.type)) return block;
  return block.type.find((b) => b.type === BlockType.Text) || block.type[block.type.length - 1];
}

// Where every sheet is, in the scroller's own content coordinates (the same
// base CodeMirror's selection layer uses, and stable across scrolling because
// the layer scrolls with the content). The sheets layer below and the Add page
// buttons (cm-add-page.js) both draw from this, so the two cannot disagree
// about where a page is.
//
// Each sheet hangs off where CodeMirror ITSELF says the page's first line is,
// not off an ideal grid. A line CodeMirror has not rendered yet has only an
// estimated height (it ignores word wrap and our narrower dialogue columns), so
// its text sits a few rows off where the grid says by the time you are several
// pages down; sheets drawn from the grid then no longer lined up with the text
// they hold. Taken from the same height map as the text, they always are, and
// correct themselves as the estimates are replaced by measurements.
export function sheetRects(view) {
  const { geom, layout } = view.state.field(pagesField);
  const doc = view.state.doc;
  const sc = view.scrollDOM.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const left = content.left - (sc.left - view.scrollDOM.scrollLeft);
  // Where the document starts, in the scroller's own content coordinates.
  const docTop = view.documentTop - (sc.top - view.scrollDOM.scrollTop);
  const rects = [];
  for (let k = 0; k < geom.count; k++) {
    const from = doc.line(Math.min(layout.pages[k].start + 1, doc.lines)).from;
    const text = textBlockAt(view, from);
    rects.push({ left, top: docTop + text.top - geom.top, width: geom.pageW, height: geom.pageH });
  }
  return { rects, geom, layout };
}

// Where the sheets go.
const pageSheets = layer({
  above: false,
  class: 'cm-page-layer',
  update(update) {
    return update.docChanged || update.geometryChanged || update.viewportChanged
      || update.transactions.some((tr) => tr.effects.some((e) => e.is(setPageMetrics)));
  },
  markers(view) {
    return sheetRects(view).rects
      .map((r) => new RectangleMarker('cm-page-sheet', r.left, r.top, r.width, r.height));
  },
});

export const scriptPages = [metricsField, pagesField, pageSheets];

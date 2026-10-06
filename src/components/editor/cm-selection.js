// The selection, drawn the way a page draws text.
//
// CodeMirror's own selection layer (drawSelection) paints the way a code editor
// does: the first line from the selection's start to the right edge, every line
// in between as one full-width band, the last line from the left edge to the
// selection's end. "Left edge" and "right edge" are measured from the content
// box, with the padding of the FIRST line in the DOM standing in for all of
// them. That holds when every line is flush left inside a box with no margins.
// A script page is neither: the margins are the content box's own padding, and
// every element has its own indent (a cue 21 characters in, a speech 10), so the
// bands began wherever the first rendered line's indent happened to put them,
// cut through the first letters of an action line, and ran out into the margin.
//
// This draws what a word processor draws instead: each ROW of text highlighted
// from its first selected character to its last, one character wider past a row
// whose line break is selected (so a blank line inside a selection shows, and
// "the paragraph break is in here" reads), and nothing in the margins or across
// a page break. Rows are as tall as the line pitch and touch, so a selection
// over several lines is one block of colour with a ragged edge, not a stack of
// bars with gaps.
//
// drawSelection() stays in the editor: it owns the caret (always exactly one
// line tall) and hides the browser's own selection and caret, and its internal
// bookkeeping cannot be reproduced from outside the package. Only its selection
// rectangles are retired, by CSS (cm-theme.js hides .cm-selectionBackground).
// This layer must be registered BEFORE the page sheets (cm-pages.js): layers
// stack in registration order, and a selection under an opaque sheet would not
// show at all.
//
// The rows come from the browser, not from arithmetic. A DOM range over the
// selected part of a line reports one rectangle per text fragment per visual row
// at the position it is actually drawn, which is the one thing that stays true
// through word wrap, per-element indents, concealed markup and whatever comes
// next. The only arithmetic is vertical: each row is snapped to the line pitch so
// rows tile.
'use strict';

import { layer, RectangleMarker } from '@codemirror/view';

// The class cm-theme.js styles (.cm-script-selection).
const SELECTION_CLASS = 'cm-script-selection';

// Fold the rectangles of the text runs a selection covers on ONE document line
// into one rectangle per visual row.
//
// `frags` are client rects ({left, right, top, bottom}); `lh` is the line pitch.
// A row's runs sit on one baseline, so their centres agree to a pixel or so, and
// rows are a pitch apart, so anything within half a pitch is the same row. Rows
// are snapped onto the first row's grid (first centre plus whole pitches) so
// consecutive rows share an edge exactly instead of differing in the last digit.
//
// Dropped: a rect with no width (a concealed marker's empty element), and one
// taller than a line and a half, which is a block that happened to fall inside
// the range (a page-gap widget), never text.
export function foldRows(frags, lh) {
  const runs = frags
    .filter((r) => r.right - r.left > 0.01 && r.bottom - r.top <= lh * 1.5)
    .map((r) => ({ left: r.left, right: r.right, cy: (r.top + r.bottom) / 2 }))
    .sort((a, b) => a.cy - b.cy || a.left - b.left);
  if (!runs.length) return [];
  const rows = [];
  const origin = runs[0].cy;
  for (const run of runs) {
    const k = Math.round((run.cy - origin) / lh);
    const last = rows[rows.length - 1];
    if (last && last.k === k) {
      last.left = Math.min(last.left, run.left);
      last.right = Math.max(last.right, run.right);
    } else {
      rows.push({ k, left: run.left, right: run.right });
    }
  }
  return rows.map((r) => ({
    left: r.left,
    right: r.right,
    top: origin + r.k * lh - lh / 2,
    bottom: origin + r.k * lh + lh / 2,
  }));
}

// The selected rows of one document line, as client rects. `from`..`to` is the
// part of the selection on this line; `past` is true when the selection runs on
// beyond the line's end, which is what selects the line break.
function rowsOfLine(view, line, from, to, past, lh, ch) {
  let rows = [];
  if (to > from) {
    // side 1 for the start and -1 for the end: both resolve INTO the line. The
    // other way round, the end of the last line resolves to a point after the
    // page filler that closes the document, and the range would swallow it.
    const a = view.domAtPos(from, 1);
    const b = view.domAtPos(to, -1);
    const range = view.dom.ownerDocument.createRange();
    try {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      rows = foldRows(Array.from(range.getClientRects()), lh);
    } catch {
      rows = []; // a position that is not rendered: nothing to draw for it
    }
  }
  if (!past) return rows;

  // The line break. It extends the line's last row, or, for a line with nothing
  // selected on it (a blank line, or a selection that begins at its very end),
  // is a mark of its own where the line would end.
  if (rows.length) {
    rows[rows.length - 1].right += ch;
  } else {
    const c = view.coordsAtPos(line.to, line.length ? -1 : 1);
    if (!c) return rows;
    const x = line.length ? c.right : c.left;
    const cy = (c.top + c.bottom) / 2;
    rows.push({ left: x, right: x + ch, top: cy - lh / 2, bottom: cy + lh / 2 });
  }
  return rows;
}

export function scriptSelection() {
  return layer({
    above: false,
    class: 'cm-script-selectionLayer',
    update(u) {
      // geometryChanged (a resize, a rewrap) is added by the layer itself.
      return u.docChanged || u.selectionSet || u.viewportChanged;
    },
    markers(view) {
      const { state } = view;
      const ranges = state.selection.ranges.filter((r) => !r.empty);
      if (!ranges.length) return [];
      const lh = view.defaultLineHeight;
      const ch = view.defaultCharacterWidth;
      // The scroller's content origin: where the layer's own (0, 0) is.
      const sc = view.scrollDOM.getBoundingClientRect();
      const baseX = sc.left - view.scrollDOM.scrollLeft * view.scaleX;
      const baseY = sc.top - view.scrollDOM.scrollTop * view.scaleY;
      const doc = state.doc;
      const out = [];
      for (const r of ranges) {
        // Only what is rendered: the viewport is what has DOM to measure.
        const start = Math.max(r.from, view.viewport.from);
        const end = Math.min(r.to, view.viewport.to);
        if (end < start) continue;
        for (let pos = start; ;) {
          const line = doc.lineAt(pos);
          const from = Math.max(r.from, line.from);
          const to = Math.min(r.to, line.to);
          const past = r.to > line.to;
          // A line holds nothing of the selection when it only touches it at its
          // own start (the selection ends where the line begins).
          if (to > from || past) {
            for (const row of rowsOfLine(view, line, from, to, past, lh, ch)) {
              out.push(new RectangleMarker(SELECTION_CLASS, row.left - baseX, row.top - baseY, row.right - row.left, row.bottom - row.top));
            }
          }
          if (line.to >= end) break;
          pos = line.to + 1;
        }
      }
      return out;
    },
  });
}

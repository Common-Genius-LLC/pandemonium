// The one piece of the selection layer that is arithmetic rather than DOM:
// folding the rectangles the browser reports for the selected text of a line
// into one rectangle per visual row (cm-selection.js foldRows). What it is
// protecting is the shape of the selection on a page: hugging each row's own
// text, tiling vertically, and never picking up anything that is not text.
'use strict';

import { describe, it, expect } from 'vitest';
import { foldRows } from './cm-selection.js';

const LH = 20;
// A text run's client rect: the content area is a little shorter than the pitch.
const run = (left, right, top) => ({ left, right, top, bottom: top + 18 });

describe('foldRows', () => {
  it('gives nothing for nothing', () => {
    expect(foldRows([], LH)).toEqual([]);
  });

  it('makes one row from the runs that share a baseline, edge to edge', () => {
    // "plain **bold** plain" is three runs on one row.
    const rows = foldRows([run(100, 140, 50), run(140, 190, 50), run(190, 260, 50)], LH);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(100);
    expect(rows[0].right).toBe(260);
  });

  it('makes a row as tall as the line pitch, centred on the text', () => {
    const [row] = foldRows([run(0, 10, 50)], LH);
    expect(row.bottom - row.top).toBe(LH);
    // The run is 18 tall at top 50, so its centre is 59.
    expect((row.top + row.bottom) / 2).toBe(59);
  });

  it('separates rows and tiles them: each shares an edge with the next', () => {
    // A wrapped line: three rows, each a pitch below the last, each its own width.
    const rows = foldRows([run(100, 300, 50), run(100, 260, 70), run(100, 140, 90)], LH);
    expect(rows.map((r) => [r.left, r.right])).toEqual([[100, 300], [100, 260], [100, 140]]);
    expect(rows[0].bottom).toBe(rows[1].top);
    expect(rows[1].bottom).toBe(rows[2].top);
  });

  it('keeps rows on one grid even when the reported tops drift by a hair', () => {
    const rows = foldRows([run(0, 10, 50), run(0, 10, 70.01), run(0, 10, 89.99)], LH);
    expect(rows).toHaveLength(3);
    expect(rows[1].top).toBe(rows[0].bottom);
    expect(rows[2].top).toBe(rows[1].bottom);
  });

  it('does not depend on the order the browser lists the runs in', () => {
    const a = foldRows([run(100, 200, 70), run(100, 300, 50), run(210, 240, 70)], LH);
    const b = foldRows([run(210, 240, 70), run(100, 300, 50), run(100, 200, 70)], LH);
    expect(a).toEqual(b);
    expect(a.map((r) => [r.left, r.right])).toEqual([[100, 300], [100, 240]]);
  });

  it('ignores a run with no width (the empty element a concealed marker leaves)', () => {
    const rows = foldRows([run(40, 40, 50), run(100, 180, 50)], LH);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(100);
  });

  it('ignores anything taller than a line and a half: a block widget, not text', () => {
    // The gap between two pages swallowed by a range that strayed outside its line.
    const gap = { left: 0, right: 800, top: 70, bottom: 400 };
    const rows = foldRows([run(100, 300, 50), gap], LH);
    expect(rows).toHaveLength(1);
    expect(rows[0].right).toBe(300);
  });
});

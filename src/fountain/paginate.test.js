// Locks screenplay page layout: the character/row grid each paper gives, how a
// line wraps (the same way the browser will wrap it, or pages drift), where
// pages break, and the page numbers. The editor and the minimap both draw from
// this, so a change here moves every page the writer sees.
'use strict';

import { describe, it, expect } from 'vitest';
import { pageGrid, wrapRows, wrapSegments, elementBox, lineTypes, paginate, pageFit, MIN_COLS } from './paginate.js';
import { parseFountain } from './parse.js';

const layout = (src, paper = 'a4') => {
  const lines = src.split('\n');
  const { cols, rows } = pageGrid(paper);
  return paginate({ lines, types: lineTypes(parseFountain(src), lines.length, lines), cols, rows });
};

describe('pageGrid', () => {
  it('gives the standard 12pt Courier grid for each paper', () => {
    expect(pageGrid('letter')).toMatchObject({ cols: 60, rows: 43 });
    expect(pageGrid('a4')).toMatchObject({ cols: 57, rows: 46 });
  });
  it('falls back to A4 for an unknown paper', () => {
    expect(pageGrid('scroll')).toMatchObject({ cols: 57, rows: 46 });
  });
});

describe('elementBox', () => {
  it('places each element at its standard indent and width', () => {
    expect(elementBox('dialogue', 60)).toEqual({ indent: 10, width: 34 });
    expect(elementBox('paren', 60)).toEqual({ indent: 16, width: 22 });
    expect(elementBox('character', 60)).toEqual({ indent: 21, width: 39 });
    expect(elementBox('action', 57)).toEqual({ indent: 0, width: 57 });
  });
});

describe('wrapRows', () => {
  it('fits a line that fits, exactly to the last column', () => {
    expect(wrapRows('', 10)).toBe(1);
    expect(wrapRows('0123456789', 10)).toBe(1);
  });
  it('moves a whole word to the next row rather than splitting it', () => {
    expect(wrapRows('aaaa bbbb cc', 10)).toBe(2); // "aaaa bbbb " then "cc"
    expect(wrapRows('aaaa bbbbbb', 10)).toBe(2);
  });
  it('lets spaces at a break hang off the row instead of starting the next', () => {
    expect(wrapRows('aaaaaaaaaa     b', 10)).toBe(2);
    expect(wrapRows('aaaaaaaaaa     ', 10)).toBe(1);
  });
  it('cuts only a word longer than the whole column', () => {
    expect(wrapRows('x'.repeat(25), 10)).toBe(3);
    expect(wrapRows('ab ' + 'x'.repeat(25), 10)).toBe(4); // "ab" alone, then 10/10/5
  });
  it('counts a real action paragraph the way a 57-column page wraps it', () => {
    const para = 'She crosses to the window and looks out at the rain for a very long time, thinking about everything.';
    expect(wrapRows(para, 57)).toBe(2);
  });
});

describe('lineTypes', () => {
  it('types every line, with title-page lines and blanks told apart', () => {
    const src = 'Title: The Shape of Memories\nAuthor: Someone\n\nINT. ROOM - DAY\n\nShe waits.';
    const lines = src.split('\n');
    expect(lineTypes(parseFountain(src), lines.length, lines)).toEqual(['title', 'title', 'blank', 'scene', 'blank', 'action']);
  });
});

describe('paginate', () => {
  it('puts a short script on one unnumbered page', () => {
    const p = layout('INT. ROOM - DAY\n\nShe waits.');
    expect(p.pages).toHaveLength(1);
    expect(p.pages[0]).toMatchObject({ start: 0, used: 3, number: 1, shown: false });
  });
  it('fills a page to its row count and carries on to the next', () => {
    const src = Array.from({ length: 60 }, (_, i) => 'Line ' + i + '.').join('\n');
    const p = layout(src, 'a4');
    expect(p.pages.map((pg) => [pg.start, pg.used])).toEqual([[0, 46], [46, 14]]);
    expect([p.pageOf[45], p.pageOf[46], p.rowOf[46]]).toEqual([0, 1, 0]);
  });
  it('numbers pages as a screenplay prints them: none on page one, "2." onward', () => {
    const src = Array.from({ length: 100 }, (_, i) => 'Line ' + i + '.').join('\n');
    const p = layout(src, 'a4');
    expect(p.pages.map((pg) => [pg.number, pg.shown])).toEqual([[1, false], [2, true], [3, true]]);
  });
  it('gives the title page its own unnumbered page, then starts the count', () => {
    const src = 'Title: Test\nAuthor: A\n\nINT. ROOM - DAY\n\nShe waits.';
    const p = layout(src);
    expect(p.pages.map((pg) => [pg.start, pg.title, pg.number])).toEqual([[0, true, null], [3, false, 1]]);
  });
  it('breaks the page at a forced break (===)', () => {
    const p = layout('One.\n\n===\n\nTwo.');
    expect(p.pages.map((pg) => pg.start)).toEqual([0, 3]);
  });
  it('never leaves a scene heading alone at the foot of a page', () => {
    // 55 filler lines and the blank line Fountain requires before a heading,
    // then the heading, a blank and action: the heading alone would fit in row
    // 57, but not with its action, so it moves over.
    const rows = pageGrid('a4').rows;
    const filler = Array.from({ length: rows - 3 }, (_, i) => 'F' + i + '.').join('\n');
    const p = layout(filler + '\n\nINT. HALL - NIGHT\n\nShe runs.');
    expect(p.pageOf[rows - 1]).toBe(1);
    expect(p.pages[0].used).toBe(rows - 2);
  });
  it('keeps a character cue with the first line of the speech', () => {
    const rows = pageGrid('a4').rows;
    const filler = Array.from({ length: rows - 2 }, (_, i) => 'F' + i + '.').join('\n');
    const p = layout(filler + '\n\nJOHN\n(quietly)\nWe should go.');
    // blank, then the cue on the last row: cue + paren + speech do not fit.
    expect(p.pageOf[rows - 1]).toBe(1);
    expect(p.rowOf[rows - 1]).toBe(0);
  });
  it('lets a line longer than a whole page run over rather than loop', () => {
    const huge = Array.from({ length: 700 }, () => 'word').join(' ');
    const p = layout('Before.\n' + huge + '\nAfter.');
    expect(p.pageOf[1]).toBe(1);
    expect(p.pageOf[2]).toBe(2);
  });
  it('lays out 60 characters a line on Letter and 57 on A4', () => {
    const line = 'x '.repeat(29) + 'x'; // 59 characters
    expect(layout(line, 'letter').rowsOf[0]).toBe(1);
    expect(layout(line, 'a4').rowsOf[0]).toBe(2);
  });
});

describe('wrapSegments', () => {
  it('gives each row its characters', () => {
    expect(wrapSegments('aaaa bbbb cc', 10)).toEqual([[0, 10], [10, 12]]);
    expect(wrapSegments('x'.repeat(25), 10)).toEqual([[0, 10], [10, 20], [20, 25]]);
    expect(wrapSegments('', 10)).toEqual([[0, 0]]);
  });
  it('always agrees with wrapRows on the number of rows, and covers the text', () => {
    const words = ['a', 'bb', 'ccc', 'dddddddd', 'eeeeeeeeeeeeeeeeeeeeeeeeeee', ' ', '  '];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 400; k++) {
      let text = '';
      const n = 1 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) text += words[Math.floor(rnd() * words.length)] + (rnd() < 0.8 ? ' ' : '');
      for (const width of [5, 10, 22, 34, 57]) {
        const segs = wrapSegments(text, width);
        expect([text, width, segs.length]).toEqual([text, width, wrapRows(text, width)]);
        expect(segs[0][0]).toBe(0);
        expect(segs[segs.length - 1][1]).toBe(text.length);
        for (let i = 1; i < segs.length; i++) expect(segs[i][0]).toBe(segs[i - 1][1]);
      }
    }
  });
});

describe('elementBox on a narrow page', () => {
  it('scales indents and widths with the page, so dialogue stays inside it', () => {
    const wide = elementBox('dialogue', 57, 57);
    const narrow = elementBox('dialogue', 38, 57);
    expect(wide).toEqual({ indent: 10, width: 34 });
    expect(narrow.indent + narrow.width).toBeLessThanOrEqual(38);
    expect(narrow.indent).toBeLessThan(wide.indent);
    expect(elementBox('character', 30, 57).indent + 8).toBeLessThanOrEqual(30);
  });
  it('does not change a page as wide as the paper', () => {
    expect(elementBox('paren', 57, 57)).toEqual({ indent: 16, width: 22 });
    expect(elementBox('paren', 80, 57)).toEqual({ indent: 16, width: 22 });
  });
});

describe('pageFit: a fixed text size, a page that gives way', () => {
  const fit = (avail) => pageFit({ paperKey: 'a4', ppi: 96, avail });
  it('is the whole paper, with the standard margins, when there is room', () => {
    const f = fit(2000);
    expect(f.pageW).toBeCloseTo(8.27 * 96, 3);
    expect(f.left).toBeCloseTo(144, 3);
    expect(f.cols).toBe(57);
  });
  it('narrows the page and keeps the margins first, so lines hold fewer characters', () => {
    const f = fit(700);
    expect(f.pageW).toBe(700);
    expect(f.left).toBeCloseTo(144, 3);
    expect(f.cols).toBeLessThan(57);
    expect(f.cols).toBeGreaterThanOrEqual(46);
  });
  it('then shrinks the margins to hold the column near 80% of a full one', () => {
    const f = fit(560);
    expect(f.left).toBeLessThan(144);
    expect(f.left).toBeGreaterThan(48);
    expect(f.cols).toBe(46);
  });
  it('finally narrows the column itself, never below the floor', () => {
    const f = fit(380);
    expect(f.left).toBeCloseTo(48, 3);
    expect(f.cols).toBeLessThan(46);
    expect(fit(10).cols).toBe(MIN_COLS);
  });
  it('never lets the text column exceed the page, and the right margin is never negative', () => {
    for (const avail of [3000, 900, 700, 600, 500, 400, 300, 200, 50]) {
      const f = fit(avail);
      expect(f.right).toBeGreaterThanOrEqual(0);
      if (avail >= 300) expect(f.left + f.cols * 9.6 + f.right).toBeCloseTo(f.pageW, 3);
    }
  });
  it('is monotone: a narrower pane never gives more columns or a wider page', () => {
    let last = fit(2000);
    for (let a = 1900; a >= 200; a -= 50) {
      const f = fit(a);
      expect(f.cols).toBeLessThanOrEqual(last.cols);
      expect(f.pageW).toBeLessThanOrEqual(last.pageW);
      last = f;
    }
  });
  it('scales with the text size: the same pane holds fewer characters at a larger size', () => {
    expect(pageFit({ ppi: 128, avail: 700 }).cols).toBeLessThan(pageFit({ ppi: 96, avail: 700 }).cols);
  });
});

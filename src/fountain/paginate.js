// Screenplay page layout, as characters and rows: where every line of the
// script falls, how many rows it wraps to, and where the pages break. Pure,
// DOM-free, and shared by the editor (which draws real pages from it) and the
// minimap (which draws the same pages small), so the two can never disagree.
//
// Why characters and rows and not pixels: screenplay type is 12pt Courier,
// which sets exactly 10 characters to the inch and 6 lines to the inch. A page
// is therefore a fixed grid (an A4 page holds 57 characters by 58 lines), and
// a page break is decided on that grid, whatever size the page is drawn at.
// That is what lets a writer enlarge the text without a single page break
// moving, and it is what keeps "one page is about one minute" honest.
//
// The layout is the standard one (the same indents the print export uses):
// margins 1in top, bottom and right and 1.5in left; dialogue 1in in and 3.4in
// wide; parentheticals 1.6in in and 2.2in wide; the character cue 2.1in in.
'use strict';

export const CPI = 10; // characters per inch at 12pt Courier
// Lines per inch. The screenplay standard is 6 (12pt on 12pt leading, which
// is single spacing and reads tight on a screen); 4.8 is 1.25 line spacing, so
// a page holds fewer rows than a printed one (46 on A4). The layout is in rows,
// so this is the one number that sets how airy the page is.
export const LPI = 4.8;

export const PAPERS = {
  a4: { label: 'A4', width: 8.27, height: 11.69 },
  letter: { label: 'US Letter', width: 8.5, height: 11 },
};

export const MARGINS = { top: 1, bottom: 1, left: 1.5, right: 1 };

// The grid a paper gives: characters per line and lines per page.
export function pageGrid(paperKey = 'a4') {
  const paper = PAPERS[paperKey] || PAPERS.a4;
  return {
    paper,
    cols: Math.floor((paper.width - MARGINS.left - MARGINS.right) * CPI + 1e-9),
    rows: Math.floor((paper.height - MARGINS.top - MARGINS.bottom) * LPI + 1e-9),
  };
}

// Where each element sits in the text column, in characters: [indent, width].
// A width of null means "to the right margin".
export const ELEMENTS = {
  scene: [0, null],
  action: [0, null],
  character: [21, null],
  paren: [16, 22],
  dialogue: [10, 34],
  lyric: [10, 34],
  transition: [0, null],
  centered: [0, null],
  section: [0, null],
  synopsis: [0, null],
  title: [0, null],
  page: [0, null],
  blank: [0, null],
};

// `refCols` is the paper's full column count. When the page is narrower than
// that (a narrow pane, see pageFit), every indent and width scales down with
// it, so dialogue stays a narrower column inside the page instead of running
// off its edge. At full width (cols >= refCols) nothing changes.
export function elementBox(type, cols, refCols = cols) {
  const [indent, width] = ELEMENTS[type] || ELEMENTS.action;
  const f = Math.min(1, cols / refCols);
  const ind = Math.round(indent * f);
  const w = width == null ? cols - ind : Math.max(8, Math.round(width * f));
  return { indent: ind, width: Math.max(1, Math.min(w, cols - ind)) };
}

// The page for a given amount of room, at a FIXED text size: the type never
// gets smaller, the page does. Three phases as the room shrinks:
//   1. the page is the paper's width (or wider than the room allows: it
//      narrows, margins untouched, and lines simply hold fewer characters);
//   2. once the text column would fall below 80% of the paper's, the MARGINS
//      shrink instead, proportionally, so the column keeps about the words a
//      printed line has;
//   3. at the minimum margins (0.5in left, 0.4in right) the column narrows
//      again, down to a floor of MIN_COLS characters.
// `ppi` is pixels per inch at the chosen text size (96 at 12pt), `avail` the
// pixels the page may use. Returns pixels, plus the column count.
export const MIN_COLS = 24;
export function pageFit({ paperKey = 'a4', ppi = 96, avail = Infinity }) {
  const paper = PAPERS[paperKey] || PAPERS.a4;
  const chW = ppi / CPI;
  const fullW = paper.width * ppi;
  const fullL = MARGINS.left * ppi;
  const fullR = MARGINS.right * ppi;
  const refCols = pageGrid(paperKey).cols;
  const pageW = Math.min(fullW, Math.max(avail, 3 * ppi));
  const keep = 0.8 * (fullW - fullL - fullR);
  let left = fullL;
  let text = pageW - fullL - fullR;
  if (text < keep) {
    const room = pageW - keep;
    const minL = 0.5 * ppi;
    const minR = 0.4 * ppi;
    if (room >= minL + minR) {
      left = fullL * (room / (fullL + fullR));
      text = keep;
    } else {
      left = minL;
      text = Math.max(pageW - minL - minR, MIN_COLS * chW);
    }
  }
  const cols = Math.max(MIN_COLS, Math.floor(text / chW + 1e-9));
  return { pageW, left, cols, refCols, right: Math.max(0, pageW - left - cols * chW) };
}

// How many rows a line of text wraps to in a column `width` characters wide,
// the way a browser lays out white-space:pre-wrap with overflow-wrap:anywhere:
// words move to the next row whole, spaces at a break hang off the end of the
// row they follow, and only a word longer than the whole column is cut.
export function wrapRows(text, width) {
  if (!text) return 1;
  let rows = 1;
  let col = 0;
  for (const tok of text.match(/\S+|\s+/g) || []) {
    if (/^\s/.test(tok)) { col += tok.length; continue; }
    let w = tok.length;
    while (col + w > width) {
      if (col > 0) { rows++; col = 0; continue; }
      w -= width;
      rows++;
    }
    col += w;
  }
  return rows;
}

// The same wrap as wrapRows, but returning each row's [start, end) character
// range, for drawing a line row by row (the minimap). Kept beside wrapRows and
// tested against it, since the two must always agree on the row count.
export function wrapSegments(text, width) {
  if (!text) return [[0, 0]];
  const segs = [];
  let rowStart = 0;
  let col = 0;
  let pos = 0;
  for (const tok of text.match(/\S+|\s+/g) || []) {
    if (/^\s/.test(tok)) { col += tok.length; pos += tok.length; continue; }
    let w = tok.length;
    let start = pos;
    while (col + w > width) {
      if (col > 0) { segs.push([rowStart, start]); rowStart = start; col = 0; continue; }
      segs.push([start, start + width]);
      start += width;
      rowStart = start;
      w -= width;
    }
    col += w;
    pos = start + w;
  }
  segs.push([rowStart, text.length]);
  return segs;
}

// The element type of every line of the document, from the parser's blocks.
// A line no block claims is a title-page line if it comes before the first
// block, and a blank line otherwise.
export function lineTypes(parsed, lineCount, lines) {
  const types = new Array(lineCount).fill(null);
  let first = Infinity;
  for (const b of parsed.blocks) {
    if (b.line == null || b.line >= lineCount) continue;
    types[b.line] = b.type;
    if (b.line < first) first = b.line;
  }
  for (let i = 0; i < lineCount; i++) {
    if (types[i]) continue;
    const blank = !lines || !String(lines[i]).trim();
    types[i] = i < first && !blank ? 'title' : 'blank';
  }
  return types;
}

// How far down the page a heading is kept with what follows it: a scene
// heading never ends a page alone, and a character cue always has the first
// line of its speech beside it. The first two rows of what follows are enough;
// requiring a whole long paragraph would throw pages away.
const KEEP_ROWS = 2;

// Lays the lines out on pages. `lines` are the raw document lines, `types` the
// element of each (see lineTypes). Returns every page's first line, how many
// rows each page uses, and for every line its page, its first row on that page
// and its row count. Breaks can only fall between lines, since a line is one
// unit in the editor; a single line longer than a whole page (rare) is put on
// a page of its own and allowed to run over.
export function paginate({ lines, types, cols, rows, refCols = cols }) {
  const n = lines.length;
  const rowsOf = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = types[i] || 'action';
    rowsOf[i] = t === 'blank' || t === 'page' ? 1 : wrapRows(lines[i], elementBox(t, cols, refCols).width);
  }
  const pageOf = new Array(n);
  const rowOf = new Array(n);
  const pages = [{ start: 0, used: 0, title: false }];
  let used = 0;
  const cur = () => pages[pages.length - 1];
  const newPage = (at) => { cur().used = used; pages.push({ start: at, used: 0, title: false }); used = 0; };

  // Rows that must fit on this page for line i to stay here.
  const needFor = (i) => {
    const t = types[i];
    if (t !== 'scene' && t !== 'character') return rowsOf[i];
    let need = rowsOf[i];
    let j = i + 1;
    if (t === 'scene') { while (j < n && types[j] === 'blank') { need += 1; j++; } }
    else { while (j < n && types[j] === 'paren') { need += rowsOf[j]; j++; } }
    if (j < n && types[j] !== 'blank' && types[j] !== 'page') need += Math.min(rowsOf[j], KEEP_ROWS);
    return need;
  };

  for (let i = 0; i < n; i++) {
    const t = types[i];
    if (used > 0 && used + needFor(i) > rows) newPage(i);
    pageOf[i] = pages.length - 1;
    rowOf[i] = used;
    used += rowsOf[i];
    if (t === 'title') cur().title = true;
    const next = i + 1 < n ? types[i + 1] : null;
    // A forced break (===) ends its page; so does the end of the title page.
    const endsTitle = t === 'title' && next != null && next !== 'title' && next !== 'blank';
    const titleThenBlanks = t === 'blank' && cur().title && next != null && next !== 'blank' && next !== 'title';
    if (next != null && (t === 'page' || endsTitle || titleThenBlanks)) newPage(i + 1);
  }
  cur().used = used;

  // Page numbers as a screenplay prints them: the title page has none, and the
  // count starts at the first page of the script, which itself is not numbered.
  const offset = pages[0] && pages[0].title ? 1 : 0;
  for (let p = 0; p < pages.length; p++) {
    const num = p - offset + 1;
    pages[p].number = pages[p].title ? null : num;
    pages[p].shown = pages[p].number != null && pages[p].number >= 2;
  }
  return { pages, pageOf, rowOf, rowsOf, types, cols, rows, refCols };
}

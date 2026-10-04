// Locks the promise a plain-text draft makes: nothing is read into the words.
// Every one of these inputs is a line Fountain would rewrite, and the point of
// the format setting is that in prose they stay what they are.
'use strict';

import { describe, it, expect } from 'vitest';
import { parsePlain } from './plain.js';
import { parseFountain } from './parse.js';
import { getParsed, clearParseCache } from './cache.js';
import { formatOf, isFormat } from '../data/formats.js';
import { lineTypes, paginate, displayLines, pageGrid } from './paginate.js';

const types = (text, opts) => parsePlain(text, opts).blocks.map((b) => b.type);

describe('a plain-text draft', () => {
  it('makes one paragraph per non-blank line', () => {
    const p = parsePlain('First line.\n\nSecond line.\n');
    expect(p.blocks).toHaveLength(2);
    expect(p.blocks.map((b) => b.plain)).toEqual(['First line.', 'Second line.']);
    expect(p.blocks.map((b) => b.line)).toEqual([0, 2]);
    expect(p.blocks.map((b) => b.i)).toEqual([0, 1]);
  });

  it('reads nothing into the shapes Fountain reads everything into', () => {
    const cases = [
      'INT. HOUSE - DAY',
      'SHE WAITS',
      'CUT TO:',
      '.FORCED',
      '@NAME',
      '> Centered <',
      '# A heading',
      '= a synopsis',
      '~ a lyric',
      '!forced action',
    ];
    for (const line of cases) {
      expect(types(line)).toEqual(['action']);
      // The text is kept exactly, marker characters and all.
      expect(parsePlain(line).blocks[0].plain).toBe(line);
    }
    // And Fountain really would have read them as something else, so this is a
    // difference the writer can see rather than a theoretical one.
    expect(parseFountain('INT. HOUSE - DAY').blocks[0].type).toBe('scene');
    expect(parseFountain('CUT TO:').blocks[0].type).toBe('transition');
  });

  it('keeps a boneyard and a note as the characters they are', () => {
    const text = 'Keep /* this */ and [[that]].';
    const p = parsePlain(text);
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].plain).toBe(text);
  });

  it('has no title page: Title: on the first line is a line', () => {
    const p = parsePlain('Title: Notes\n\nFirst.\n');
    expect(p.title).toEqual({});
    expect(p.blocks[0].plain).toBe('Title: Notes');
  });

  it('keeps asterisks as asterisks, and gives Markdown its emphasis', () => {
    expect(parsePlain('a **bold** word').blocks[0].plain).toBe('a **bold** word');
    const md = parsePlain('a **bold** word', { emphasis: true }).blocks[0];
    expect(md.plain).toBe('a bold word');
    expect(md.runs.some((r) => r.b)).toBe(true);
  });

  it('records indentation as the offset the highlight map needs', () => {
    const b = parsePlain('    indented line').blocks[0];
    expect(b.textOffset).toBe(4);
    expect(b.plain).toBe('indented line');
    // plainToRaw maps every plain character to a real one in b.text.
    expect(b.plainToRaw[0]).toBe(0);
    expect(b.plainToRaw[b.plain.length - 1]).toBe(b.text.length - 1);
  });

  it('counts words, which is what the estimate and the counter read', () => {
    expect(parsePlain('one two three').blocks[0].words).toBe(3);
  });

  it('survives an empty document', () => {
    expect(parsePlain('').blocks).toEqual([]);
    expect(parsePlain(null).blocks).toEqual([]);
  });
});

// The page is laid out from the same machinery whatever the format, so a plain
// draft has to go through it without special cases.
describe('a plain draft on the page', () => {
  it('lays out as paragraphs, with no title page and nothing outside its sheet', () => {
    const text = Array.from({ length: 80 }, (_, k) => `Paragraph ${k + 1}.`).join('\n\n');
    const lines = text.split('\n');
    const parsed = parsePlain(text);
    const grid = pageGrid('a4');
    const out = paginate({
      lines,
      types: lineTypes(parsed, lines.length, lines),
      display: displayLines(parsed, lines),
      cols: grid.cols,
      rows: grid.rows,
    });
    expect(out.pages.length).toBeGreaterThan(1);
    expect(out.pages[0].title).toBe(false);
    for (const page of out.pages) expect(page.used).toBeLessThanOrEqual(grid.rows);
  });

  it('is drawn exactly as it is stored: nothing is concealed', () => {
    const text = '# Not a section\n\n.Not a heading';
    const lines = text.split('\n');
    expect(displayLines(parsePlain(text), lines)).toEqual(lines);
  });
});

// The one thing read in every format: the document's own page break, which is
// what Add page writes (components/editor/cm-add-page.js).
describe('a page break in a plain draft', () => {
  it('is a line of equals signs with a blank line before it', () => {
    const p = parsePlain('One.\n\n===\n\nTwo.\n');
    expect(p.blocks.map((b) => b.type)).toEqual(['action', 'page', 'action']);
    expect(p.blocks[1].line).toBe(2);
  });
  it('counts at the very start of the document', () => {
    expect(parsePlain('===\n\nOne.').blocks.map((b) => b.type)).toEqual(['page', 'action']);
  });
  it('is not a Markdown setext underline, which has text right above it', () => {
    const p = parsePlain('My heading\n===\n\nBody.', { emphasis: true });
    expect(p.blocks.map((b) => b.type)).toEqual(['action', 'action', 'action']);
    expect(p.blocks[1].plain).toBe('===');
  });
  it('is drawn where it stands, and takes one row', () => {
    const text = 'One.\n\n===\n\nTwo.';
    const lines = text.split('\n');
    const parsed = parsePlain(text);
    expect(displayLines(parsed, lines)[2]).toBe('===');
    const grid = pageGrid('a4');
    const out = paginate({
      lines,
      types: lineTypes(parsed, lines.length, lines),
      display: displayLines(parsed, lines),
      cols: grid.cols,
      rows: grid.rows,
    });
    // Two pages, and the second starts after the break.
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1].start).toBe(3);
  });
  it('breaks the page in a Markdown draft too', () => {
    const text = '# Notes\n\n===\n\nMore.';
    const lines = text.split('\n');
    const parsed = parsePlain(text, { emphasis: true });
    const grid = pageGrid('a4');
    const out = paginate({
      lines,
      types: lineTypes(parsed, lines.length, lines),
      display: displayLines(parsed, lines),
      cols: grid.cols,
      rows: grid.rows,
    });
    expect(out.pages).toHaveLength(2);
  });
});

describe('the format on a script record', () => {
  it('defaults an older file to Fountain, which is what it was written as', () => {
    expect(formatOf({ id: 'a', text: 'INT. X - DAY' })).toBe('fountain');
    expect(formatOf({ id: 'a', format: 'nonsense' })).toBe('fountain');
    expect(formatOf(null)).toBe('fountain');
  });
  it('knows its three formats and nothing else', () => {
    expect(['text', 'markdown', 'fountain'].every(isFormat)).toBe(true);
    expect(isFormat('rtf')).toBe(false);
  });
  it('parses each script by its own format, and re-parses when it changes', () => {
    clearParseCache();
    const script = { id: 's1', text: 'CUT TO:', format: 'text' };
    expect(getParsed(script).blocks[0].type).toBe('action');
    expect(getParsed({ ...script, format: 'fountain' }).blocks[0].type).toBe('transition');
  });
});

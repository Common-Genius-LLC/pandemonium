// A stress test for the script builder: the whole pure pipeline a keystroke
// goes through, from the Fountain source to the page it is drawn on.
//
//   parseFountain   what each line MEANS, and exactly where it is
//   displayLines    what each line is DRAWN as (the syntax is concealed)
//   lineTypes       the element of every line, including the ones no block owns
//   paginate        which sheet each line falls on, and how many rows it takes
//
// Three of these have to agree on every line of the document or the sheets
// drift away from the text they hold, which is what "the text comes out of the
// page" looked like. The invariants below are the agreement, written down.
//
// The fixture here is a deliberately synthetic torture file, not a screenplay:
// it exists to hold one of every construct hard rule 2 names, and it is not a
// stand-in for the-shape-of-memories.fountain, which is still owed to the repo.
'use strict';

import { describe, it, expect } from 'vitest';
import { parseFountain, maskBoneyard, boneyardRanges } from './parse.js';
import { applyElement } from './element-ops.js';
import {
  lineTypes, displayLines, paginate, pageGrid, elementBox, wrapRows, wrapSegments,
} from './paginate.js';

// One of every construct in hard rule 2, plus the ones around them.
const TORTURE = [
  'Title: The Torture Test',
  'Credit: written by',
  'Author: Nobody At All',
  'Draft date: 2026',
  '',
  '# ACT ONE',
  '',
  '= A summary line that says what the act is for.',
  '',
  'INT. KITCHEN - DAY',
  '',
  'Action with **bold** and *italic* and _underline_ and [[a note]] in it.',
  '',
  '/* a boneyard',
  'spanning three',
  'lines */',
  '',
  'JANE',
  '(quietly)',
  'The first line of the speech.',
  'The second line of the speech.',
  '',
  '.FORCED HEADING',
  '',
  '!INT. NOT A HEADING AT ALL',
  '',
  '~a lyric line',
  '',
  '> CUT TO:',
  '',
  '> THE END <',
  '',
  '===',
  '',
  'After the forced page break.',
].join('\n');

const lines = (src) => src.split('\n');

describe('the parser keeps every block where it really is', () => {
  const src = TORTURE;
  const raw = lines(src);
  const masked = lines(maskBoneyard(src));
  const parsed = parseFountain(src);

  it('masks the boneyard without moving a line or a column', () => {
    expect(masked.length).toBe(raw.length);
    raw.forEach((l, i) => expect(masked[i].length).toBe(l.length));
    expect(masked[13].trim()).toBe('');
    expect(masked[14].trim()).toBe('');
    expect(masked[15].trim()).toBe('');
  });

  it('reports the boneyard ranges against the real document', () => {
    const [[from, to]] = boneyardRanges(src);
    expect(src.slice(from, to).startsWith('/*')).toBe(true);
    expect(src.slice(from, to).endsWith('*/')).toBe(true);
  });

  // The regression: cutting the boneyard out before splitting shifted every
  // block below it up by three lines, so the editor formatted the wrong lines
  // and every link anchor after it resolved to the wrong characters.
  it('does not shift the blocks that follow a multi-line boneyard', () => {
    const cue = parsed.blocks.find((b) => b.type === 'character');
    expect(raw[cue.line]).toBe('JANE');
    const last = parsed.blocks[parsed.blocks.length - 1];
    expect(raw[last.line]).toBe('After the forced page break.');
  });

  it('puts every block on a line whose raw text really contains it', () => {
    for (const b of parsed.blocks) {
      if (!b.text) continue;
      expect(masked[b.line].substr(b.textOffset, b.text.length)).toBe(b.text);
    }
  });

  it('maps every plain character back to the raw character it came from', () => {
    for (const b of parsed.blocks) {
      let prev = -1;
      for (let k = 0; k < b.plain.length; k++) {
        const r = b.plainToRaw[k];
        expect(r).toBeGreaterThan(prev);
        expect(masked[b.line][b.textOffset + r]).toBe(b.plain[k]);
        prev = r;
      }
    }
  });

  it('reads every construct hard rule 2 names', () => {
    const seen = new Set(parsed.blocks.map((b) => b.type));
    for (const t of ['section', 'synopsis', 'scene', 'action', 'character', 'paren', 'dialogue', 'lyric', 'transition', 'centered', 'page']) {
      expect(seen.has(t), `no ${t} block`).toBe(true);
    }
    expect(parsed.title.title).toBe('The Torture Test');
    expect(parsed.title['draft date']).toBe('2026');
  });
});

describe("Fountain's forcing marks beat its guesses", () => {
  const typeOf = (line) => {
    const b = parseFountain(`\n${line}\n`).blocks[0];
    return b && b.type;
  };

  // `!` and `~` used to be tested AFTER the INT./EXT. and "... TO:" rules, so
  // the one thing the element picker writes to say "this is action, whatever it
  // looks like" was read straight back as a heading or a transition.
  it('reads !INT. as action, not a scene heading', () => expect(typeOf('!INT. HOUSE - DAY')).toBe('action'));
  it('reads !CUT TO: as action, not a transition', () => expect(typeOf('!CUT TO:')).toBe('action'));
  it('reads ~CUT TO: as a lyric, not a transition', () => expect(typeOf('~CUT TO:')).toBe('lyric'));
  it('reads ~INT. as a lyric', () => expect(typeOf('~INT. HOUSE')).toBe('lyric'));
  it('still reads a bare INT. as a scene heading', () => expect(typeOf('INT. HOUSE - DAY')).toBe('scene'));
  it('still reads a bare CUT TO: as a transition', () => expect(typeOf('CUT TO:')).toBe('transition'));
  it('keeps the forcing mark out of the text it reports', () => {
    expect(parseFountain('\n!CUT TO:\n').blocks[0].text).toBe('CUT TO:');
  });
});

describe('applying an element cannot leave junk behind', () => {
  // "..." is an ellipsis, and Fountain says a '.' followed by another '.' is
  // not a forced heading. Making it one used to add a dot per press: "....",
  // then ".....", and it never became a heading at all.
  it('turns an ellipsis into a real heading, once', () => {
    const once = applyElement('...', 'scene');
    expect(applyElement(once, 'scene')).toBe(once);
    expect(parseFountain(`\n${once}\n`).blocks[0].type).toBe('scene');
  });

  it('is idempotent for every element on text that starts with markup', () => {
    const starts = ['', '...', '.', 'hello', 'INT. X - DAY', '> CUT TO:', '> mid <', '# s', '= s', '~l', '(p)', '[[ n ]]', '!a', '@jane'];
    const keys = ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'centered', 'lyric', 'section', 'section2', 'section3', 'synopsis', 'note'];
    for (const s of starts) {
      for (const k of keys) {
        const a = applyElement(s, k);
        expect(applyElement(a, k), `${JSON.stringify(s)} -> ${k}`).toBe(a);
      }
    }
  });
});

describe('the page is laid out from what is drawn, not from the source', () => {
  const src = TORTURE;
  const raw = lines(src);
  const parsed = parseFountain(src);
  const drawn = displayLines(parsed, raw);

  it('conceals the markup the editor conceals', () => {
    expect(drawn[5]).toBe('ACT ONE');                       // # section
    expect(drawn[7]).toBe('A summary line that says what the act is for.'); // = synopsis
    expect(drawn[11]).toBe('Action with bold and italic and underline and a note in it.');
    expect(drawn[22]).toBe('FORCED HEADING');               // .forced
    expect(drawn[24]).toBe('INT. NOT A HEADING AT ALL');    // !forced action
    expect(drawn[26]).toBe('a lyric line');                 // ~lyric
    expect(drawn[28]).toBe('CUT TO:');                      // > transition
    expect(drawn[30]).toBe('THE END');                      // > centered <
  });

  it('leaves a line no block owns exactly as it stands', () => {
    expect(drawn[0]).toBe('Title: The Torture Test');       // title page
    expect(drawn[13]).toBe('/* a boneyard');                // shown, a step back
    expect(drawn[32]).toBe('===');                          // the forced break itself
  });

  it('keeps whatever the editor does not conceal', () => {
    const d = displayLines(parseFountain('\nJANE ^\nSpeech.\n'), ['', 'JANE ^', 'Speech.', '']);
    expect(d[1]).toBe('JANE ^');
  });

  // The whole point: a paragraph full of emphasis was paginated several
  // characters per marker too long, so its page filled early and the sheets
  // drifted off the text.
  it('counts fewer rows for a line whose markup is concealed', () => {
    const long = 'x '.repeat(20) + '**' + 'y '.repeat(20).trim() + '**';
    const p = parseFountain(long);
    const d = displayLines(p, [long]);
    expect(wrapRows(d[0], 40)).toBeLessThanOrEqual(wrapRows(long, 40));
    expect(d[0].length).toBe(long.length - 4);
  });
});

// Every invariant the editor's sheets rely on, over the torture file and over
// a pile of generated documents. A seeded generator, so a failure is a case
// anyone can reproduce by running this file again.
describe('the page layout holds together', () => {
  const grid = pageGrid('a4');

  const check = (src) => {
    const raw = lines(src);
    const masked = lines(maskBoneyard(src));
    const parsed = parseFountain(src);
    const types = lineTypes(parsed, raw.length, raw);
    const display = displayLines(parsed, raw);
    const problems = [];

    expect(masked.length).toBe(raw.length);
    raw.forEach((l, i) => expect(masked[i].length).toBe(l.length));

    for (const cols of [grid.cols, 40, 24]) {
      const L = paginate({ lines: raw, types, display, cols, rows: grid.rows, refCols: grid.cols });

      let prevStart = -1;
      for (const pg of L.pages) {
        if (pg.start <= prevStart) problems.push(`page starts not increasing at ${pg.start}`);
        prevStart = pg.start;
      }

      // No page holds more rows than a page has, unless one single line is
      // taller than a whole page (which has nowhere else to go).
      const sums = new Array(L.pages.length).fill(0);
      for (let i = 0; i < raw.length; i++) {
        if (L.pageOf[i] == null) { problems.push(`line ${i} on no page`); continue; }
        sums[L.pageOf[i]] += L.rowsOf[i];
      }
      L.pages.forEach((pg, k) => {
        if (sums[k] !== pg.used) problems.push(`page ${k} says ${pg.used} rows, its lines are ${sums[k]}`);
        const alone = raw.length > pg.start && L.rowsOf[pg.start] > grid.rows;
        if (pg.used > grid.rows && !alone) problems.push(`page ${k} overfilled: ${pg.used} > ${grid.rows}`);
      });

      // rowOf is the running row inside its own page...
      let acc = 0;
      let page = 0;
      for (let i = 0; i < raw.length; i++) {
        if (L.pageOf[i] !== page) { page = L.pageOf[i]; acc = 0; }
        if (L.rowOf[i] !== acc) problems.push(`line ${i} starts at row ${L.rowOf[i]}, should be ${acc}`);
        acc += L.rowsOf[i];
      }

      // ...and the minimap, which draws row by row, must find the same rows.
      for (let i = 0; i < raw.length; i++) {
        if (types[i] === 'page') continue;
        const w = elementBox(types[i] === 'blank' ? 'action' : types[i], cols, grid.cols).width;
        const segs = wrapSegments(display[i], w).length;
        if (segs !== L.rowsOf[i]) problems.push(`line ${i}: ${L.rowsOf[i]} rows but ${segs} drawn segments`);
      }
    }
    return problems;
  };

  it('over the torture file', () => expect(check(TORTURE)).toEqual([]));

  it('over 400 generated documents', () => {
    let seed = 20260928;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const words = ['she', 'HE', 'walks', 'slowly', 'door', 'RAIN', 'a', 'the', 'kerb', '19-inch', 'alloys,', 'antidisestablishmentarianism'];
    const say = (n) => Array.from({ length: n }, () => pick(words)).join(' ');
    const oddities = ['\tindented with a tab', '...', 'Ellipsis... and more', 'UBERMENSCH walks - slowly',
      'pneumonoultramicroscopicsilicovolcanoconiosisantidisestablishmentarianism', '@jane', 'JANE ^',
      '!INT. NOT A HEADING', '~CUT TO:', '   ', '>', '==='];

    const line = () => {
      switch (Math.floor(rnd() * 16)) {
        case 0: return `INT. ${say(3).toUpperCase()} - DAY`;
        case 1: return `.${say(2).toUpperCase()}`;
        case 2: return `> ${say(2).toUpperCase()} TO:`;
        case 3: return `> ${say(3)} <`;
        case 4: return `# ${say(2)}`;
        case 5: return `### ${say(3)}`;
        case 6: return `= ${say(6)}`;
        case 7: return `~${say(5)}`;
        case 8: return `[[${say(4)}]]`;
        case 9: return say(2).toUpperCase();
        case 10: return `(${say(2)})`;
        case 11: return pick(oddities);
        case 12: return '';
        case 13: return `Action with **${say(2)}** and *${say(2)}* and _${say(1)}_.`;
        case 14: return `!${say(4)}`;
        default: return say(1 + Math.floor(rnd() * 40));
      }
    };

    const failures = [];
    for (let doc = 0; doc < 400; doc++) {
      const out = [];
      if (rnd() < 0.4) out.push(`Title: ${say(3)}`, `Author: ${say(2)}`, '');
      const n = 5 + Math.floor(rnd() * 70);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.06) { out.push(`/* ${say(3)}`, say(4), `${say(2)} */`); continue; }
        if (rnd() < 0.04) { out.push(`${say(2)} /* ${say(2)} */ ${say(3)}`); continue; }
        out.push(line());
      }
      const src = out.join('\n');
      const problems = check(src);
      if (problems.length) failures.push({ doc, problems: problems.slice(0, 3), src: src.slice(0, 400) });
      if (failures.length) break;
    }
    expect(failures).toEqual([]);
  });
});

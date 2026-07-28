'use strict';

import { describe, it, expect } from 'vitest';
import { MARKERS, canFormat, toggleMarker } from './inline-format.js';
import { parseFountain } from './parse.js';

// The point of these: emphasis is written into the Fountain source, so the
// only proof that a toggle is correct is that the parser reads back the runs
// the writer asked for. Asserting on the output string alone would pass for
// markup that happens to look right and parse wrong.
function runsOf(text) {
  const parsed = parseFountain(text);
  return parsed.blocks[0].runs.map((r) => ({ t: r.t, b: !!r.b, i: !!r.i, u: !!r.u }));
}

describe('canFormat', () => {
  it('accepts the elements whose parse cannot be broken by a delimiter', () => {
    for (const el of ['action', 'dialogue', 'centered', 'lyric', 'synopsis']) {
      expect(canFormat(el)).toBe(true);
    }
  });

  // These are the ones the parser identifies BY their exact text, so a stray
  // delimiter can change what the line is rather than how it looks.
  it('refuses the rigid elements', () => {
    for (const el of ['scene', 'character', 'transition', 'paren', 'section', 'note']) {
      expect(canFormat(el)).toBe(false);
    }
  });

  it('refuses an unknown element rather than assuming it is safe', () => {
    expect(canFormat('something-added-later')).toBe(false);
    expect(canFormat(undefined)).toBe(false);
  });
});

describe('toggleMarker', () => {
  it('wraps a selection and keeps the same words selected', () => {
    const out = toggleMarker('she runs home', 4, 8, MARKERS.bold);
    expect(out.text).toBe('she **runs** home');
    expect(out.text.slice(out.from, out.to)).toBe('runs');
  });

  it('unwraps when the markers sit just outside the selection', () => {
    const text = 'she **runs** home';
    const out = toggleMarker(text, 6, 10, MARKERS.bold);
    expect(out.text).toBe('she runs home');
    expect(out.text.slice(out.from, out.to)).toBe('runs');
  });

  it('unwraps when the markers are inside the selection', () => {
    const out = toggleMarker('she **runs** home', 4, 12, MARKERS.bold);
    expect(out.text).toBe('she runs home');
    expect(out.text.slice(out.from, out.to)).toBe('runs');
  });

  it('round-trips: wrap then unwrap returns the original', () => {
    const original = 'she runs home';
    const on = toggleMarker(original, 4, 8, MARKERS.italic);
    const off = toggleMarker(on.text, on.from, on.to, MARKERS.italic);
    expect(off.text).toBe(original);
  });

  it('parks the caret between the delimiters on an empty selection', () => {
    const out = toggleMarker('she runs', 8, 8, MARKERS.bold);
    expect(out.text).toBe('she runs****');
    expect(out.from).toBe(10);
    expect(out.to).toBe(10);
  });

  it('does not read behind the start of the line looking for a marker', () => {
    const out = toggleMarker('go', 0, 2, MARKERS.bold);
    expect(out.text).toBe('**go**');
  });
});

describe('what the parser reads back', () => {
  it('bold is a bold run and the delimiters are not in the plain text', () => {
    const { text } = toggleMarker('she runs home', 4, 8, MARKERS.bold);
    expect(runsOf(text)).toEqual([
      { t: 'she ', b: false, i: false, u: false },
      { t: 'runs', b: true, i: false, u: false },
      { t: ' home', b: false, i: false, u: false },
    ]);
  });

  it('italic inside bold parses as bold-italic, not as broken markup', () => {
    const bold = toggleMarker('she runs home', 4, 8, MARKERS.bold);
    const both = toggleMarker(bold.text, bold.from, bold.to, MARKERS.italic);
    expect(both.text).toBe('she ***runs*** home');
    expect(runsOf(both.text).find((r) => r.t === 'runs')).toEqual({ t: 'runs', b: true, i: true, u: false });
  });

  // The regression these delimiter-run rules exist for: treating bold and
  // italic as independent wrappers made italic steal one of bold's asterisks
  // and silently demote it to italic.
  it('turning italic off leaves bold behind', () => {
    const both = toggleMarker('she ***runs*** home', 7, 11, MARKERS.italic);
    expect(both.text).toBe('she **runs** home');
    expect(runsOf(both.text).find((r) => r.t === 'runs')).toEqual({ t: 'runs', b: true, i: false, u: false });
  });

  it('turning bold off leaves italic behind', () => {
    const out = toggleMarker('she ***runs*** home', 7, 11, MARKERS.bold);
    expect(out.text).toBe('she *runs* home');
    expect(runsOf(out.text).find((r) => r.t === 'runs')).toEqual({ t: 'runs', b: false, i: true, u: false });
  });

  it('a lone asterisk on one side is text, not half a delimiter', () => {
    const out = toggleMarker('a *b c', 3, 6, MARKERS.bold);
    expect(out.text).toBe('a ***b c**');
  });

  it('underline is a distinct run from bold', () => {
    const { text } = toggleMarker('she runs home', 4, 8, MARKERS.underline);
    expect(runsOf(text).find((r) => r.t === 'runs')).toEqual({ t: 'runs', b: false, i: false, u: true });
  });

  it('an action line stays an action line after formatting', () => {
    const { text } = toggleMarker('she runs home', 4, 8, MARKERS.bold);
    expect(parseFountain(text).blocks[0].type).toBe('action');
  });
});

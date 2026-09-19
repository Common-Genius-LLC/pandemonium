'use strict';

import { describe, it, expect } from 'vitest';
import { snapToWords, resolvePart } from './resolve.js';

describe('snapToWords', () => {
  it('leaves a range already on word boundaries untouched', () => {
    expect(snapToWords('the quick fox', 4, 9)).toEqual({ s: 4, e: 9 });
  });

  it('grows a mid-word start back to the word start', () => {
    // "the qu|ick fox" -> should grow back to "quick"
    expect(snapToWords('the quick fox', 6, 9)).toEqual({ s: 4, e: 9 });
  });

  it('grows a mid-word end forward to the word end', () => {
    // "the qu|ick fox" selection ending mid "quick" -> should grow to "quick"
    expect(snapToWords('the quick fox', 4, 6)).toEqual({ s: 4, e: 9 });
  });

  it('grows both ends when the range starts and ends mid-word', () => {
    expect(snapToWords('the quick fox', 5, 8)).toEqual({ s: 4, e: 9 });
  });

  it('treats an apostrophe as part of the word', () => {
    const text = "it wasn't there";
    // select just "asn" inside "wasn't" -> should grow to the whole contraction
    const idx = text.indexOf('asn');
    const r = snapToWords(text, idx, idx + 3);
    expect(text.slice(r.s, r.e)).toBe("wasn't");
  });

  it('does not expand across a boundary that is already a word edge', () => {
    expect(snapToWords('the quick fox', 0, 3)).toEqual({ s: 0, e: 3 });
  });
});

describe('resolvePart with word-snapped quotes', () => {
  it('still resolves after the anchored word grows (quote match, unaffected by snapping itself)', () => {
    const plains = ['the quick fox jumps'];
    const part = { q: 'quick', b: 0, s: 4 };
    expect(resolvePart(plains, part)).toEqual({ bi: 0, s: 4, e: 9 });
  });
});

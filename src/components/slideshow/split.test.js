// The preview's picture/script divider arithmetic.
'use strict';

import { describe, it, expect } from 'vitest';
import { DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT, clampSplit, splitFromPointer, textScale } from './split.js';

describe('clampSplit', () => {
  it('keeps the split within its bounds and falls back on junk', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0)).toBe(MIN_SPLIT);
    expect(clampSplit(5)).toBe(MAX_SPLIT);
    expect(clampSplit('0.4')).toBe(0.4);
    expect(clampSplit(NaN)).toBe(DEFAULT_SPLIT);
    expect(clampSplit(undefined)).toBe(DEFAULT_SPLIT);
  });
});

describe('splitFromPointer', () => {
  it('is the pointer distance from the bottom edge, as a fraction of the box', () => {
    // A 1000px box at the top of the screen: a pointer at y=700 leaves 300px below.
    expect(splitFromPointer(700, 0, 1000)).toBeCloseTo(0.3);
    expect(splitFromPointer(500, 0, 1000)).toBeCloseTo(0.5);
  });

  it('accounts for the box not starting at zero, and clamps at both ends', () => {
    expect(splitFromPointer(600, 100, 1000)).toBeCloseTo(0.5);
    expect(splitFromPointer(0, 0, 1000)).toBe(MAX_SPLIT);
    expect(splitFromPointer(1000, 0, 1000)).toBe(MIN_SPLIT);
  });

  it('falls back to the default for an unmeasured box', () => {
    expect(splitFromPointer(300, 0, 0)).toBe(DEFAULT_SPLIT);
  });
});

describe('textScale', () => {
  it('is 1 at the default and grows and shrinks with the strip', () => {
    expect(textScale(DEFAULT_SPLIT)).toBeCloseTo(1);
    expect(textScale(0.6)).toBeGreaterThan(1);
    expect(textScale(0.15)).toBeLessThan(1);
  });

  it('grows more slowly than the strip does, and stays within limits', () => {
    expect(textScale(0.6)).toBeLessThan(0.6 / DEFAULT_SPLIT);
    expect(textScale(MAX_SPLIT)).toBeLessThanOrEqual(1.9);
    expect(textScale(MIN_SPLIT)).toBeGreaterThanOrEqual(0.6);
  });
});

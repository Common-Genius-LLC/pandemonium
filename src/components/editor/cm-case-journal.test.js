'use strict';

import { describe, it, expect } from 'vitest';
import { revertPlan } from './cm-case-journal.js';
import { applyElementTo } from '../../fountain/element-ops.js';
import { parseFountain } from '../../fountain/parse.js';

// Builds the journal entry setLine() would record for applying `key` to
// `before`, so these tests exercise the real transform rather than a
// hand-written idea of what it produces.
const UPPER = new Set(['scene', 'character', 'transition']);

function transform(before, key, sep = 0) {
  const { text: after } = applyElementTo(before, key);
  return { entry: { pos: 0, before, after, sep, upper: UPPER.has(key) }, after };
}

// What a line typed under a pinned upper-casing element looks like: autoUppercase
// rewrites the whole line inside the same transaction as the keystroke, so the
// writer's lower-case input never survives in the document.
function typedUnderPin(after, typed) {
  return (after + typed).toUpperCase();
}

describe('revertPlan', () => {
  it('gives back the writer casing after a character cue transform', () => {
    const { entry, after } = transform('jane', 'character');
    expect(after).toBe('JANE');
    expect(revertPlan(after, entry).text).toBe('jane');
  });

  it('gives back both casing and markup after a scene heading transform', () => {
    const { entry, after } = transform('kitchen', 'scene');
    expect(after).toBe('.KITCHEN');
    expect(revertPlan(after, entry).text).toBe('kitchen');
  });

  it('strips the transition markup as well as the casing', () => {
    const { entry, after } = transform('cut to', 'transition');
    expect(revertPlan(after, entry).text).toBe('cut to');
  });

  // The case that motivated the `upper` flag. Under a pinned upper element the
  // writer cannot type a lower-case character, so every capital in the tail is
  // the editor's own doing and lower-casing it is restoring, not guessing.
  it('lower-cases text typed after an upper-casing transform', () => {
    const { entry, after } = transform('jane', 'character');
    const current = typedUnderPin(after, ' doe');
    expect(current).toBe('JANE DOE');
    expect(revertPlan(current, entry).text).toBe('jane doe');
  });

  it('leaves text typed after a non-upper-casing transform exactly as typed', () => {
    const { entry, after } = transform('a thought', 'lyric');
    expect(after).toBe('~a thought');
    expect(revertPlan(after + ' In Caps', entry).text).toBe('a thought In Caps');
  });

  it('seeds and reverts an empty line without leaving markup behind', () => {
    const { entry, after } = transform('', 'scene');
    expect(after).toBe('.');
    expect(revertPlan(typedUnderPin(after, 'kitchen'), entry).text).toBe('kitchen');
  });

  it('reports the separator line the transform inserted so it can be removed too', () => {
    const { entry, after } = transform('jane', 'character', 1);
    expect(revertPlan(after, entry).sep).toBe(1);
  });

  // The safety property: if the writer edited INSIDE the transformed text, the
  // plan can no longer account for what is on the line, so it declines rather
  // than rewriting text it does not understand.
  it('declines when the line no longer starts with what the transform produced', () => {
    const { entry } = transform('jane', 'character');
    expect(revertPlan('THE JANE', entry)).toBeNull();
    expect(revertPlan('JAN', entry)).toBeNull();
    expect(revertPlan('', entry)).toBeNull();
  });

  it('declines when there is nothing recorded', () => {
    expect(revertPlan('anything', null)).toBeNull();
  });

  it('declines a no-op transform that inserted no separator', () => {
    const entry = { pos: 0, before: 'plain line', after: 'plain line', sep: 0, upper: false };
    expect(revertPlan('plain line', entry)).toBeNull();
  });
});

describe('what the parser reads back after a revert', () => {
  it('a reverted cue is no longer a cue, which is what was asked for', () => {
    const { entry, after } = transform('jane', 'character');
    const reverted = revertPlan(after, entry).text;
    // The cue test needs a following line to fire at all, so compare the two
    // documents rather than the single line.
    expect(parseFountain('JANE\nhello').blocks[0].type).toBe('character');
    expect(parseFountain(reverted + '\nhello').blocks[0].type).toBe('action');
  });

  it('a reverted scene heading is an ordinary action line again', () => {
    const { entry, after } = transform('kitchen', 'scene');
    expect(parseFountain(after).blocks[0].type).toBe('scene');
    expect(parseFountain(revertPlan(after, entry).text).blocks[0].type).toBe('action');
  });
});

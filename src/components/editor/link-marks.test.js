// Locks how linked words are classified: the editor's colour rules need at most
// one board class per word (disjointBoardClass), and the minimap reads the same
// decorations for the kinds each word carries (kindsOfDecoration).
'use strict';

import { describe, it, expect } from 'vitest';
import { disjointBoardClass } from './cm-fountain-plugin.js';
import { kindsOfDecoration } from './cm-script-minimap.js';

describe('disjointBoardClass', () => {
  it('leaves a word with one board class alone', () => {
    expect(disjointBoardClass('hb')).toBe('hb');
    expect(disjointBoardClass('hbr hr')).toBe('hbr hr');
  });
  it('lets a final storyboard win over a reference-only one on the same words', () => {
    expect(disjointBoardClass('hb hbr')).toBe('hb');
    expect(disjointBoardClass('hb hbr hr hc')).toBe('hb hr hc');
  });
  it('does not touch words with no board', () => {
    expect(disjointBoardClass('hr hc')).toBe('hr hc');
    expect(disjointBoardClass(undefined)).toBe('');
  });
});

describe('kindsOfDecoration', () => {
  const mark = (cls, attr = 'x') => ({ spec: { class: cls, attributes: { 'data-hl': attr } } });
  it('reads the kinds off a link mark', () => {
    expect(kindsOfDecoration(mark('hb hr'))).toEqual({ board: 'final', ref: true, comment: false });
    expect(kindsOfDecoration(mark('hbr hc'))).toEqual({ board: 'ref', ref: false, comment: true });
  });
  it('ignores every decoration that is not a link mark, however its classes look', () => {
    expect(kindsOfDecoration({ spec: { class: 'cmf-lk cmf-lk-b' } })).toBeNull();
    expect(kindsOfDecoration({ spec: { class: 'cmf-character' } })).toBeNull();
    expect(kindsOfDecoration({ spec: { class: 'hr', attributes: {} } })).toBeNull();
    expect(kindsOfDecoration(null)).toBeNull();
  });
  it('ignores a link mark that carries none of the three kinds', () => {
    expect(kindsOfDecoration(mark('hp'))).toBeNull();
  });
});

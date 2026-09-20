// Locks how linked words are classified for the two things that mark them
// without painting them: the margin markers in the editor (linkKindClasses)
// and the gutter bars in the minimap (kindsOfDecoration). Both read the same
// highlight decorations, so they must agree on what "a storyboard", "a
// reference" and "a comment" are.
'use strict';

import { describe, it, expect } from 'vitest';
import { linkKindClasses } from './cm-fountain-plugin.js';
import { kindsOfDecoration } from './cm-script-minimap.js';

describe('linkKindClasses', () => {
  it('marks a storyboard, a reference and a comment separately', () => {
    expect(linkKindClasses({ cls: 'hb', idAttr: 'b:1' })).toEqual(['cmf-lk-b']);
    expect(linkKindClasses({ cls: 'hr', idAttr: 'r:1' })).toEqual(['cmf-lk-r']);
    expect(linkKindClasses({ cls: 'hc', idAttr: 'c:1' })).toEqual(['cmf-lk-c']);
  });
  it('gives a reference-only storyboard its own marker', () => {
    expect(linkKindClasses({ cls: 'hbr', idAttr: 'b:1' })).toEqual(['cmf-lk-br']);
  });
  it('carries every kind the same words have', () => {
    expect(linkKindClasses({ cls: 'hb hr hc', idAttr: 'b:1 r:2 c:3' })).toEqual(['cmf-lk-b', 'cmf-lk-r', 'cmf-lk-c']);
  });
  it('lets a final frame win over a reference-only one on the same words', () => {
    expect(linkKindClasses({ cls: 'hb hbr', idAttr: 'b:1 b:2' })).toEqual(['cmf-lk-b']);
  });
  it('gives a link still being made no marker, since it is transient', () => {
    expect(linkKindClasses({ cls: 'hp', idAttr: 'p:pending' })).toEqual([]);
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

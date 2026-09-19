// Locks the rule that stops the element menu eating the first letter of a
// paragraph. The menu opens on Enter on an empty line (the ordinary paragraph
// break in Fountain), and the next keystroke used to be read as a shortcut
// whenever it matched a row's letter, case-insensitively: "She" became a scene
// heading, "The" a transition (`> HE FLOORBOARDS...`), and the letter was lost.
'use strict';

import { describe, it, expect } from 'vitest';
import { shortcutForKey } from './element-menu.js';

describe('shortcutForKey', () => {
  it('picks the row for a plain lowercase letter', () => {
    expect(shortcutForKey('s').el).toBe('scene');
    expect(shortcutForKey('t').el).toBe('transition');
    expect(shortcutForKey('c').el).toBe('character');
    expect(shortcutForKey('d').el).toBe('dialogue');
  });

  it('types a capital instead, so a sentence can start with any letter', () => {
    // Every letter that has a shortcut, capitalised: none may be taken.
    for (const k of 'GSACPDTHLNQE') expect(shortcutForKey(k)).toBeNull();
    expect(shortcutForKey('S')).toBeNull(); // "She"
    expect(shortcutForKey('T')).toBeNull(); // "The"
    expect(shortcutForKey('H')).toBeNull(); // "He"
    expect(shortcutForKey('A')).toBeNull(); // "A"
  });

  it('types a digit instead, so a paragraph can start with a number', () => {
    for (const k of '0123') expect(shortcutForKey(k)).toBeNull(); // "3 YEARS LATER"
  });

  it('types a lowercase letter that has no row', () => {
    expect(shortcutForKey('x')).toBeNull();
    expect(shortcutForKey('m')).toBeNull();
  });

  it('ignores symbols, named keys and non-strings', () => {
    expect(shortcutForKey('.')).toBeNull();
    expect(shortcutForKey('Enter')).toBeNull();
    expect(shortcutForKey('')).toBeNull();
    expect(shortcutForKey(undefined)).toBeNull();
  });
});

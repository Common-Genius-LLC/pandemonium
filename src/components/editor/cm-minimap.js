// A code-editor-style minimap along the script's right edge: a scaled-down
// render of the whole document so a long screenplay stays scannable while
// you write. Third-party (@replit/codemirror-minimap); it samples
// getComputedStyle off the real editor content for its text colors, so that
// part already follows cm-theme.js and the active theme's tokens. Two things
// are ours: the small overrides below for the minimap's own chrome, and the
// gutter marks (a 4px bar beside every line a storyboard link lands on:
// green for a final board, yellow for a reference one).
//
// The gutter is drawn on a canvas, where a CSS var() does not resolve, so the
// caller reads the token values off the DOM and passes concrete colors in
// (see script-editor.js #minimapMarksEffect); nothing here hardcodes one.
'use strict';

import { EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { showMinimap } from '@replit/codemirror-minimap';

// Value: {[lineNumber]: color}, 1-based line numbers as the minimap expects.
export const setMinimapMarks = StateEffect.define();

const minimapMarks = StateField.define({
  create: () => ({}),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMinimapMarks)) return e.value;
    return value;
  },
});

export const fountainMinimap = [
  minimapMarks,
  showMinimap.compute(['doc', minimapMarks], (state) => ({
    create: () => ({ dom: document.createElement('div') }),
    displayText: 'blocks',
    showOverlay: 'mouse-over',
    gutters: [state.field(minimapMarks)],
  })),
];

export const minimapTheme = EditorView.theme({
  '.cm-minimap-gutter': {
    backgroundColor: 'var(--panel)',
    borderLeft: '1px solid var(--ph)',
  },
});

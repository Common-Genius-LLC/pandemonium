// Visual formatting for the unified editor, applied as line/mark CSS
// classes (see cm-fountain-plugin.js) over the real, unmodified source
// text. References the app's CSS custom properties directly -- they
// inherit into CodeMirror's injected stylesheet the same way they inherit
// into any other shadow root.
//
// Deliberately not replicating the old preview's vertical margins between
// blocks (26px above a scene heading, etc): CodeMirror's own line-height
// bookkeeping is not guaranteed to stay correct with margins on `.cm-line`,
// so this uses padding instead, which is the supported way to add per-line
// spacing. It reads slightly tighter than the old read-only preview did;
// that's an acceptable trade next to breaking scroll/selection math.
'use strict';

import { EditorView } from '@codemirror/view';

export const fountainTheme = EditorView.theme({
  '&': {
    color: 'var(--ink)',
    backgroundColor: 'var(--bg)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 4px 40vh 4px',
    caretColor: 'var(--ink)',
  },
  '.cm-line': {
    padding: '2px 0',
  },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--pend) !important' },

  '.cmf-scene': { fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.02em', paddingTop: '18px' },
  '.cmf-character': { textAlign: 'center', textTransform: 'uppercase', paddingTop: '10px' },
  '.cmf-paren': { textAlign: 'center', color: 'var(--ui)' },
  '.cmf-dialogue': { maxWidth: '62%', margin: '0 auto', textAlign: 'left' },
  '.cmf-transition': { textAlign: 'right', textTransform: 'uppercase' },
  '.cmf-centered': { textAlign: 'center' },
  '.cmf-lyric': { fontStyle: 'italic', paddingLeft: '1.5em' },
  '.cmf-section': {
    fontFamily: 'var(--sans)', fontSize: '11px', fontWeight: '500',
    letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mut)', paddingTop: '14px',
  },
  '.cmf-synopsis': { fontFamily: 'var(--sans)', fontSize: '11px', color: 'var(--mut)', fontStyle: 'italic' },

  '.hb': { background: 'var(--board)', cursor: 'pointer', borderRadius: '1px' },
  '.hr': { background: 'var(--res)', color: '#fff', cursor: 'pointer', borderRadius: '1px' },
  '.hb.hr': { background: 'linear-gradient(180deg,var(--board) 50%,var(--res) 50%)', color: 'var(--ink)', cursor: 'pointer', borderRadius: '1px' },
  '.hp': { background: 'var(--pend)', borderRadius: '1px' },
  // Comments read as an annotation underline, not a filled highlight, so they
  // stay legible even where they overlap a board/research span.
  '.hc': { borderBottom: '2px solid var(--act)', cursor: 'pointer' },
  '.hl-flash': { background: 'var(--act) !important', color: 'var(--ink) !important' },

  // Section hover model (cm-sections.js): a soft rounded band behind the
  // whole hovered Fountain section, plus the floating Board/Source rail.
  '.cm-sec-hover': { background: 'var(--panel)' },
  '.cm-sec-hover[data-secpos=first]': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px' },
  '.cm-sec-hover[data-secpos=last]': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' },
  '.cm-sec-hover[data-secpos=solo]': { borderRadius: '6px' },
  '.cm-sec-acts': {
    position: 'absolute', right: '10px', zIndex: '6', display: 'flex', gap: '2px', padding: '3px',
    background: 'var(--ui)', borderRadius: 'var(--r)', boxShadow: '0 1px 5px rgba(0,0,0,.2)', fontFamily: 'var(--sans)',
  },
  '.cm-sec-acts button': {
    color: '#fff', fontSize: '11px', fontWeight: '500', padding: '4px 9px', background: 'none', border: '0',
    borderRadius: '2px', cursor: 'pointer', fontFamily: 'var(--sans)', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  },
  '.cm-sec-acts button:hover': { background: 'rgba(255,255,255,.16)' },
  '.cm-sec-acts button::before': { content: '""', width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block', marginRight: '6px' },
  '.cm-sec-acts button.b::before': { background: 'var(--board)' },
  '.cm-sec-acts button.r::before': { background: 'var(--res)' },
  '.cm-sec-acts button.n::before': { background: 'var(--act)' },
});

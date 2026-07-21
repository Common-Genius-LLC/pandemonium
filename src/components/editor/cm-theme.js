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
    // The panel shell (styles/shared.js) owns the pane's fill and its corners;
    // the editor just fills it.
    backgroundColor: 'transparent',
    height: '100%',
    fontSize: '16px',
    // The element menu (element-menu.js) is positioned against this box.
    position: 'relative',
  },
  '.cm-scroller': {
    fontFamily: 'var(--script)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '10px 10px 40vh 10px',
    caretColor: 'var(--ink)',
  },
  // "Start writing your script", shown only over an empty document.
  '.cm-placeholder': {
    color: 'var(--ink)',
    opacity: '.5',
  },
  // The neutral line. Everything an element rule below can set is reset to its
  // plain-action value here, so a line with no element class (a blank line, or
  // one the parser has not made up its mind about yet) can never keep the look
  // of the element that used to be there.
  '.cm-line': {
    textAlign: 'left',
    maxWidth: 'none',
    margin: '0',
    padding: '2px 0',
    textTransform: 'none',
    fontWeight: '400',
    fontStyle: 'normal',
    letterSpacing: 'normal',
    color: 'var(--ink)',
  },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--pend) !important' },

  // Standard screenplay formatting, applied live (cm-fountain-plugin.js).
  // Character cues and section titles are bold; scene headings / characters /
  // transitions are upper-cased; the dialogue block is a centred column (with
  // its text left-aligned inside it, as on a real page) so it reads like a
  // page without depending on a fixed panel width. Only horizontal margins
  // here; vertical spacing stays as padding (see the module note on why
  // margins on .cm-line are avoided).
  //
  // Every element rule below is SELF-CONTAINED: each one restates the whole
  // set of properties any element rule touches (alignment, column width,
  // case, weight, slant, colour, indent, spacing), rather than relying on
  // .cm-line's defaults for the ones it does not care about. Screenplay
  // elements are exclusive by nature, and a line that ends up carrying two of
  // these classes, or that keeps a class for a frame longer than the parser
  // agrees with, must never end up wearing half of one element and half of
  // another (that is how action lines inherited dialogue's centring). The
  // .cm-line prefix also keeps these off the marks inside a line.
  '.cm-line.cmf-scene': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'uppercase',
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: '.02em',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '18px 0 2px 0',
  },
  '.cm-line.cmf-action': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '2px 0',
  },
  '.cm-line.cmf-character': {
    textAlign: 'center', maxWidth: 'none', margin: '0', textTransform: 'uppercase',
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '10px 0 2px 0',
  },
  '.cm-line.cmf-paren': {
    textAlign: 'center', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ui)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '2px 0',
  },
  '.cm-line.cmf-dialogue': {
    textAlign: 'left', maxWidth: '62%', margin: '0 auto', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '2px 0',
  },
  '.cm-line.cmf-transition': {
    textAlign: 'right', maxWidth: 'none', margin: '0', textTransform: 'uppercase',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '10px 0 2px 0',
  },
  '.cm-line.cmf-centered': {
    textAlign: 'center', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '2px 0',
  },
  '.cm-line.cmf-lyric': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '2px 0 2px 1.5em',
  },
  '.cm-line.cmf-section': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: '.01em',
    fontFamily: 'var(--script)', fontSize: '17px', padding: '16px 0 2px 0',
  },
  '.cm-line.cmf-synopsis': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--mut)', letterSpacing: 'normal',
    fontFamily: 'var(--sans)', fontSize: '13px', padding: '2px 0',
  },

  // Inline emphasis + Obsidian-style concealed syntax. Markers are hidden
  // (Decoration.replace) on lines the caret isn't on, and dimmed (.cmf-syntax)
  // on the line being edited, so a line reads as formatted until you enter it.
  '.cmf-b': { fontWeight: '700' },
  '.cmf-i': { fontStyle: 'italic' },
  '.cmf-u': { textDecoration: 'underline' },
  '.cmf-note': { color: 'var(--mut)', fontStyle: 'italic' },
  '.cmf-syntax': { opacity: '0.45' },

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

  // Element menu (element-menu.js): the Enter-on-an-empty-line chooser. Dark
  // chrome, like the section rail above, so it reads as a tool floating over
  // the page rather than as part of the script.
  '.cm-elmenu': {
    position: 'absolute', zIndex: '20', minWidth: '240px', maxHeight: '320px', overflowY: 'auto',
    background: 'var(--ui)', borderRadius: 'var(--r)', boxShadow: '0 6px 22px rgba(0,0,0,.32)',
    padding: '4px', fontFamily: 'var(--sans)', fontSize: '12px', lineHeight: '1.2',
  },
  '.cm-elmenu-row': {
    display: 'flex', alignItems: 'baseline', gap: '8px', padding: '5px 8px',
    borderRadius: '2px', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-elmenu-row:hover': { background: 'rgba(255,255,255,.12)' },
  '.cm-elmenu-row.sel': { background: 'var(--act)', color: 'var(--ink)' },
  '.cm-elmenu-k': { fontVariantNumeric: 'tabular-nums', opacity: '.7', width: '22px' },
  '.cm-elmenu-l': { flex: '1', fontWeight: '500' },
  // What the row actually writes into the Fountain source.
  '.cm-elmenu-w': { opacity: '.55', fontSize: '11px' },
  '.cm-elmenu-row.sel .cm-elmenu-k, .cm-elmenu-row.sel .cm-elmenu-w': { opacity: '.75' },
});

// Visual formatting for the unified editor, applied as line/mark CSS
// classes (see cm-fountain-plugin.js) over the real, unmodified source
// text. References the app's CSS custom properties directly -- they
// inherit into CodeMirror's injected stylesheet the same way they inherit
// into any other shadow root.
//
// The script is laid out as real pages (cm-pages.js, fountain/paginate.js):
// 12pt Courier on a fixed grid of characters and rows, which is the only way
// the browser's line wrapping and the page layout can agree. So every line
// here is exactly one row high per wrapped row: no vertical padding or margin
// on any element, no letter-spacing, no size or font that differs from the
// script's own. Space between elements is what it is on a real page, the
// blank lines in the text. Horizontal placement is in `ch` (one character),
// with the same indents the print export uses.
//
// The page geometry arrives as custom properties set by script-editor.js
// (--pg-font, --pg-lh, --pg-cols, --pg-w, --pg-left, --pg-top), because the
// size follows the text-size preference and shrinks to fit a narrow pane.
'use strict';

import { EditorView } from '@codemirror/view';

// Linked words are coloured, per word, by what they link to: a storyboard
// green, a reference-only storyboard orange, a reference pink, a comment amber.
// Colouring the words themselves (and not a marker beside the line) is what
// keeps two portions of one sentence apart when they link to different things.
//
//   at rest   the text takes the kind's colour; words carrying two or three
//             kinds take a smooth left-to-right GRADIENT of them (gradient
//             text, so it reads as one continuous colour, not as bands), which
//             says at a glance that more than one thing is attached
//   on hover  ONE soft tint appears behind the words, whatever they carry, in
//             the colour of the highest-priority kind: a comment first, then a
//             reference, then a storyboard (HOVER_PRIORITY). The hover says
//             "this is what you are on"; a click shows everything attached
//
// The text colours are the kind colours mixed toward the ink, so they stay
// legible on the page in both themes; the hover tints are light washes. Every
// rule is generated from this one table, so the single, two-kind and three-kind
// cases cannot drift apart.
const KIND_TEXT = {
  hb: 'color-mix(in srgb, var(--board-strong) 78%, var(--ink))',
  hbr: 'color-mix(in srgb, var(--board-ref) 82%, var(--ink))',
  hr: 'color-mix(in srgb, var(--res) 82%, var(--ink))',
  hc: 'color-mix(in srgb, var(--act) 55%, var(--ink))',
};
// Which kind's tint wins on hover when the same words carry more than one.
const HOVER_PRIORITY = ['hc', 'hr', 'hb', 'hbr'];
const KIND_TINT = {
  hb: 'var(--board)',
  hbr: 'color-mix(in srgb, var(--board-ref) 50%, transparent)',
  hr: 'color-mix(in srgb, var(--res) 24%, transparent)',
  hc: 'color-mix(in srgb, var(--act) 55%, transparent)',
};

function linkRules() {
  const rules = {
    '.hb, .hbr, .hr, .hc': {
      cursor: 'pointer', borderRadius: '2px',
      transition: 'background-color var(--dur-1) var(--ease-out)',
    },
  };
  // A word has at most one board class (cm-fountain-plugin.js disjointBoardClass),
  // so these are all the combinations there can be.
  for (const board of [null, 'hb', 'hbr']) {
    for (const ref of [false, true]) {
      for (const comment of [false, true]) {
        const kinds = [board, ref && 'hr', comment && 'hc'].filter(Boolean);
        if (!kinds.length) continue;
        const sel = '.' + kinds.join('.');
        if (kinds.length === 1) {
          rules[sel] = { color: KIND_TEXT[kinds[0]] };
          rules[sel + ':hover'] = { backgroundColor: KIND_TINT[kinds[0]] };
          continue;
        }
        const text = `linear-gradient(90deg,${kinds.map((k) => KIND_TEXT[k]).join(',')})`;
        const top = HOVER_PRIORITY.find((k) => kinds.includes(k));
        // One flat tint (a gradient of one colour, so it can sit in a layer).
        const tint = `linear-gradient(90deg,${KIND_TINT[top]},${KIND_TINT[top]})`;
        rules[sel] = { color: 'transparent', backgroundImage: text, backgroundClip: 'text', WebkitBackgroundClip: 'text' };
        // The text gradient stays on top; the one tint sits under it. The
        // single-kind hover tints that also match this word are cleared.
        rules[sel + ':hover'] = {
          backgroundColor: 'transparent',
          backgroundImage: `${text}, ${tint}`,
          backgroundClip: 'text, border-box',
          WebkitBackgroundClip: 'text, border-box',
        };
      }
    }
  }
  return rules;
}

export const fountainTheme = EditorView.theme({
  '&': {
    color: 'var(--ink)',
    // The panel shell (styles/shared.js) owns the pane's fill and its corners;
    // the editor just fills it.
    backgroundColor: 'transparent',
    height: '100%',
    fontSize: 'var(--pg-font, 16px)',
    // The element menu (element-menu.js) is positioned against this box.
    position: 'relative',
  },
  '.cm-scroller': {
    fontFamily: 'var(--script)',
    lineHeight: 'var(--pg-lh, 16px)',
    // overflow-x hidden so the full-bleed row-hover band (which extends far past
    // the text column, see .cm-sec-hover) is clipped to the panel instead of
    // creating a horizontal scrollbar. lineWrapping means there is no real
    // horizontal content to scroll.
    //
    // The desk is the pane's own fill, inherited: script-panel.js sets
    // --pane-bg on the shell and custom properties cross shadow roots, so the
    // desk can never drift from the chrome strip above it. It used to be grey,
    // which made this the one pane that did not match the others.
    // Auto, not hidden: a page larger than the pane (a bigger text size in a
    // narrow pane) scrolls sideways. The hover band stays bounded by
    // .cm-content's own overflow:hidden.
    overflowX: 'auto',
    overflowY: 'auto',
    backgroundColor: 'var(--pane-bg)',
  },
  // The text column of the pages. Its border box is exactly one sheet wide
  // (paper width at the current size): the left and right paddings are the
  // page margins, and the width between them is the grid's column count in
  // characters, plus a hair, so the browser fits exactly that many characters
  // on a row and never one fewer to a rounding error. The sheets themselves
  // are drawn behind it by cm-pages.js (.cm-page-sheet), so this box is
  // transparent. overflow:hidden bounds .cm-sec-hover's -50vw band to the
  // page's edges; isolation keeps that band above the sheet.
  '.cm-content': {
    boxSizing: 'content-box',
    flexGrow: '0',
    flexShrink: '0',
    width: 'calc(var(--pg-cols, 57) * 1ch + 0.3ch)',
    maxWidth: 'none',
    margin: '12px auto 38vh auto',
    padding: 'var(--pg-top, 96px) calc(var(--pg-w, 794px) - var(--pg-left, 144px) - var(--pg-cols, 57) * 1ch - 0.3ch) 0 var(--pg-left, 144px)',
    backgroundColor: 'transparent',
    caretColor: 'var(--ink)',
    overflow: 'hidden',
    isolation: 'isolate',
  },
  // A sheet: the typing surface's own fill, set off from the white desk by a
  // hairline in the theme's placeholder grey and the faintest lift.
  '.cm-page-sheet': {
    backgroundColor: 'var(--field)',
    boxShadow: '0 0 0 1px var(--ph), 0 2px 6px rgba(0,0,0,.05)',
  },
  '.cm-page-gap': { position: 'relative' },
  // The page number, top right of its page, at the right margin, as printed.
  '.cm-page-num': {
    position: 'absolute', right: '0', color: 'var(--mut)', fontFamily: 'var(--script)',
    fontSize: 'inherit', lineHeight: 'var(--pg-lh, 16px)', pointerEvents: 'none',
  },
  // "Start with a summary of the script", shown only over an empty document.
  // Styled exactly like a Fountain synopsis line (.cm-line.cmf-synopsis
  // below), since that is the element the first keystroke actually becomes
  // (see cm-summary-default.js).
  '.cm-placeholder': {
    color: 'var(--mut)',
    fontStyle: 'italic',
    fontWeight: '400',
    fontFamily: 'var(--script)',
    fontSize: 'inherit',
  },
  // The neutral line. Everything an element rule below can set is reset to its
  // plain-action value here, so a line with no element class (a blank line, or
  // one the parser has not made up its mind about yet) can never keep the look
  // of the element that used to be there.
  '.cm-line': {
    textAlign: 'left',
    maxWidth: 'none',
    margin: '0',
    padding: '0',
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
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },
  '.cm-line.cmf-action': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },
  // The cue 2.1in in, the parenthetical 1.6in in and 2.2in wide, the speech
  // 1in in and 3.4in wide: the standard page, and the indents the print export
  // and fountain/paginate.js ELEMENTS use. Widths get the same hair of slack
  // as the column, so exactly that many characters fit.
  '.cm-line.cmf-character': {
    textAlign: 'left', maxWidth: 'calc((var(--pg-cols, 57) - var(--pg-i-char, 21)) * 1ch + 0.3ch)', margin: '0', textTransform: 'uppercase',
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0 0 0 calc(var(--pg-i-char, 21) * 1ch)',
  },
  '.cm-line.cmf-paren': {
    textAlign: 'left', maxWidth: 'calc(var(--pg-w-paren, 22) * 1ch + 0.3ch)', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ui)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0 0 0 calc(var(--pg-i-paren, 16) * 1ch)',
  },
  '.cm-line.cmf-dialogue': {
    textAlign: 'left', maxWidth: 'calc(var(--pg-w-dlg, 34) * 1ch + 0.3ch)', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0 0 0 calc(var(--pg-i-dlg, 10) * 1ch)',
  },
  '.cm-line.cmf-transition': {
    // Muted like paren: a technical directive (CUT TO:, FADE OUT:), not story
    // content, so it recedes a step rather than competing with it for
    // attention. Same tier as paren, not synopsis's lighter --mut, since it's
    // still a craft element a writer reads deliberately, not a summary aside.
    textAlign: 'right', maxWidth: 'none', margin: '0', textTransform: 'uppercase',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--ui)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },
  '.cm-line.cmf-centered': {
    textAlign: 'center', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },
  '.cm-line.cmf-lyric': {
    // Muted for the same reason as transition: it's marked ~like this~
    // precisely because it's a secondary reading, sung rather than spoken,
    // and should read as a step removed from ordinary dialogue.
    textAlign: 'left', maxWidth: 'calc(var(--pg-w-dlg, 34) * 1ch + 0.3ch)', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--ui)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0 0 0 calc(var(--pg-i-dlg, 10) * 1ch)',
  },
  '.cm-line.cmf-section': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '700', fontStyle: 'normal', color: 'var(--ink)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },
  '.cm-line.cmf-synopsis': {
    textAlign: 'left', maxWidth: 'none', margin: '0', textTransform: 'none',
    fontWeight: '400', fontStyle: 'italic', color: 'var(--mut)', letterSpacing: 'normal',
    fontFamily: 'var(--script)', fontSize: 'inherit', padding: '0',
  },

  // Inline emphasis + Obsidian-style concealed syntax. Markers are hidden
  // (Decoration.replace) on lines the caret isn't on, and dimmed (.cmf-syntax)
  // on the line being edited, so a line reads as formatted until you enter it.
  '.cmf-b': { fontWeight: '700' },
  '.cmf-i': { fontStyle: 'italic' },
  '.cmf-u': { textDecoration: 'underline' },
  '.cmf-note': { color: 'var(--mut)', fontStyle: 'italic' },
  '.cmf-syntax': { opacity: '0.45' },

  // Storyboard links: green for a final board, yellow for a reference board.
  // The yellow is the action token softened with color-mix, not a new color,
  // so it sits next to the soft --board green at a similar weight in both
  // themes.
  ...linkRules(),
  '.hp': { background: 'var(--pend)', borderRadius: '1px' },

  '.hl-flash': { background: 'var(--act) !important', color: 'var(--ink) !important' },

  // Section hover model (cm-sections.js): a flat band behind the whole hovered
  // Fountain section, plus the two-pill rail from the Figma paragraph element
  // (node 85-590) -- a dark "link to" pill and a yellow "Comment" pill at the
  // row's right edge. The band bleeds the full width of the panel (edge to
  // edge, no rounded corners) to keep the surface calm: it is drawn as a
  // pseudo-element stretched -10px past the line box (cancelling .cm-content's
  // 10px inset) and sat behind the text with z-index, since a line
  // decoration's own background can only reach the text column, not the panel
  // edge. Adjacent lines' bands touch, so a multiline section reads as one
  // continuous strip from the very left to the very right.
  '.cm-sec-hover': { position: 'relative' },
  // -50vw each side so the band always reaches the panel edges no matter how a
  // line is indented (dialogue and character are centered columns, so a small
  // fixed negative would stop short of the edge). The scroller clips the
  // overflow (lineWrapping means there is no real horizontal scroll to lose).
  '.cm-sec-hover::before': {
    content: '""', position: 'absolute', top: '0', bottom: '0', left: '-50vw', right: '-50vw',
    background: 'var(--row-hover)', zIndex: '-1', pointerEvents: 'none',
  },
  // While an image is being dragged over the editor, the row it would board
  // lights the app pink with white script text (drop to board it).
  '.cm-scroller.img-drag .cm-sec-hover::before': { background: 'var(--res)', opacity: '1' },
  '.cm-scroller.img-drag .cm-sec-hover': { color: '#fff' },
  '.cm-sec-acts': {
    position: 'absolute', right: '10px', zIndex: '6', display: 'flex', gap: '6px', fontFamily: 'var(--sans)',
  },
  '.cm-sec-acts button': {
    fontSize: '12px', fontWeight: '500', lineHeight: '1', padding: '6px 12px', minHeight: '24px', border: '0',
    borderRadius: '20px', cursor: 'pointer', fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
    // The same lift as the File and account controls in the title bar.
    boxShadow: '0 1px 1.25px rgba(0,0,0,.25)',
  },
  // The element-type pill (item 6, neutral), the dark pill (link to) and the
  // yellow pill (Comment). All use theme tokens rather than the Figma literals
  // so they hold up in dark mode.
  '.cm-sec-acts button.elt': { background: 'var(--panel)', color: 'var(--ui)' },
  '.cm-sec-acts button.elt:hover': { background: 'var(--ph-hi)' },
  '.cm-sec-acts button.linkto': { background: 'var(--overlay)', color: 'var(--overlay-ink)' },
  '.cm-sec-acts button.linkto:hover': { background: 'var(--ui)' },
  '.cm-sec-acts button.comment': { background: 'var(--act)', color: 'var(--act-ink)' },
  '.cm-sec-acts button.comment:hover': { background: 'var(--act-hi)' },

  // Element menu (element-menu.js): the Enter-on-an-empty-line chooser. Dark
  // chrome, like the section rail above, so it reads as a tool floating over
  // the page rather than as part of the script.
  '.cm-elmenu': {
    position: 'absolute', zIndex: '20', minWidth: '240px', maxHeight: '320px', overflowY: 'auto',
    background: 'var(--overlay)', borderRadius: 'var(--r)', boxShadow: '0 6px 22px rgba(0,0,0,.32)',
    padding: '4px', fontFamily: 'var(--sans)', fontSize: '12px', lineHeight: '1.2',
  },
  '.cm-elmenu-row': {
    display: 'flex', alignItems: 'baseline', gap: '8px', padding: '5px 8px',
    borderRadius: '2px', color: 'var(--overlay-ink)', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-elmenu-row:hover': { background: 'rgba(255,255,255,.12)' },
  '.cm-elmenu-row.sel': { background: 'var(--act)', color: 'var(--act-ink)' },
  '.cm-elmenu-k': { fontVariantNumeric: 'tabular-nums', opacity: '.7', width: '22px' },
  '.cm-elmenu-l': { flex: '1', fontWeight: '500' },
  // What the row actually writes into the Fountain source.
  '.cm-elmenu-w': { opacity: '.55', fontSize: '11px' },
  '.cm-elmenu-row.sel .cm-elmenu-k, .cm-elmenu-row.sel .cm-elmenu-w': { opacity: '.75' },
});

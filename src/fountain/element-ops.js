// Screenplay element operations for the editor's element picker (notes.md
// point 2). Real screenplay editors let you set a line's element type; in a
// Fountain app that means rewriting the line with the right forcing/markup
// (fountain.io/syntax) and reading the current element straight from the
// parser's block type. Doing it this way keeps the app Fountain-faithful
// (hard rule 2): every element round-trips through the plain-text source, so
// nothing here can introduce a type the file can't represent.
//
// Names echo the Final Draft element list the notes asked for. Fountain has no
// distinct Shot / Cast List / Show Title element, so those aren't offered as
// separate types; structural beats (New Act, Sequence, Outline levels) are
// Fountain Sections, and Summary is a Synopsis.
'use strict';

export const ELEMENT_LABELS = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  paren: 'Parenthetical',
  transition: 'Transition',
  centered: 'Centered',
  lyric: 'Lyric',
  section: 'Section / Act',
  synopsis: 'Synopsis',
  note: 'Note',
};

// Menu order, roughly the order you meet these while writing a scene. Fountain
// "notes" ([[ ]]) aren't a block element (they're inline annotations), and the
// app already has a dedicated Comments feature for that, so Note isn't offered
// here as an element type.
export const ELEMENT_MENU = ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'centered', 'lyric', 'section', 'synopsis'];

// parse.js block.type -> element key for the current-element display. Types
// with no picker entry (e.g. 'page') fall back to Action.
export function elementOfBlock(block) {
  if (!block) return 'action';
  return ELEMENT_LABELS[block.type] ? block.type : 'action';
}

const SCENE_RE = /^(INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s]/i;
const FOUNTAIN_TRIGGER = /^[.@>~#=!([]/;

// Strip whatever forcing/markup a line currently carries so a different
// element can be applied cleanly. Mirrors the constructs parse.js recognises.
function stripForcing(raw) {
  const s = raw.trim();
  let m;
  if ((m = s.match(/^>\s*(.*?)\s*<$/))) return m[1].trim();            // centered
  if ((m = s.match(/^\[\[\s*([\s\S]*?)\s*\]\]$/))) return m[1].trim(); // note
  if ((m = s.match(/^\((.*)\)$/))) return m[1].trim();                 // parenthetical
  if ((m = s.match(/^#{1,6}\s*(.*)$/))) return m[1].trim();            // section
  if (s[0] === '=') return s.slice(1).trim();                          // synopsis
  if (/^\.[^.]/.test(s)) return s.slice(1).trim();                     // forced scene
  if (s[0] === '@' || s[0] === '!' || s[0] === '~') return s.slice(1).trim(); // forced char/action/lyric
  if (s[0] === '>') return s.replace(/^>\s*/, '').trim();              // forced transition
  return s;
}

// Rewrite one line's raw text so the parser reads it as `key`. Scene headings,
// characters and transitions are upper-cased (the "format as you go" part,
// point 4) -- itself valid Fountain. Forcing marks are only added when the
// plain text wouldn't otherwise parse as that element, so ordinary lines stay
// clean (no stray '!' on every action line).
export function applyElement(raw, key) {
  const c = stripForcing(raw);
  if (!c) {
    // Empty line: seed only the markup that can't be inferred later. Character
    // needs none -- pinning the element (see cm-autoformat.js) upper-cases what
    // you type and the cue is recognised once dialogue follows, so no stray '@'.
    return { scene: '.', action: '', character: '', dialogue: '', paren: '()', transition: '> ', centered: '> <', lyric: '~', section: '# ', synopsis: '= ', note: '[[  ]]' }[key] || '';
  }
  switch (key) {
    case 'scene': { const up = c.toUpperCase(); return SCENE_RE.test(up) ? up : '.' + up; }
    case 'character': return c.toUpperCase();
    case 'transition': { const up = c.toUpperCase(); return /TO:$/.test(up) ? up : '> ' + c; }
    case 'action': return (FOUNTAIN_TRIGGER.test(c) || SCENE_RE.test(c) || /TO:$/.test(c.toUpperCase())) ? '!' + c : c;
    case 'dialogue': return c;
    case 'paren': return '(' + c.replace(/^\(|\)$/g, '').trim() + ')';
    case 'lyric': return '~' + c;
    case 'centered': return '> ' + c + ' <';
    case 'section': return '# ' + c;
    case 'synopsis': return '= ' + c;
    case 'note': return '[[ ' + c + ' ]]';
    default: return c;
  }
}

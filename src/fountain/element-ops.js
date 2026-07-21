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
  section2: 'Sequence',
  section3: 'Outline 3',
  synopsis: 'Synopsis',
  note: 'Note',
};

// Menu order, roughly the order you meet these while writing a scene. Fountain
// "notes" ([[ ]]) aren't a block element (they're inline annotations), and the
// app already has a dedicated Comments feature for that, so Note isn't offered
// here as an element type.
export const ELEMENT_MENU = ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'centered', 'lyric', 'section', 'synopsis'];

// The list the editor pops up when you press Enter on an empty line, with
// Final Draft's own letter shortcuts (from the reference screenshot). Fountain
// has no Shot, Cast List, Show Title or act-structure elements, so those rows
// map onto the closest construct the format really has, and every row states
// the markup it writes. The menu offers Final Draft's vocabulary; the file
// still only ever contains Fountain (hard rule 2), and saying which construct
// each row writes is what keeps that from being a surprise.
export const ELEMENT_SHORTCUTS = [
  { k: 'G', label: 'General', el: 'action', writes: 'plain line' },
  { k: 'S', label: 'Scene Heading', el: 'scene', writes: 'INT. / .forced' },
  { k: 'A', label: 'Action', el: 'action', writes: 'plain line' },
  { k: 'C', label: 'Character', el: 'character', writes: 'CAPS cue' },
  { k: 'P', label: 'Parenthetical', el: 'paren', writes: '( )' },
  { k: 'D', label: 'Dialogue', el: 'dialogue', writes: 'under a cue' },
  { k: 'T', label: 'Transition', el: 'transition', writes: '> TO:' },
  { k: 'H', label: 'Shot', el: 'scene', writes: '.forced heading' },
  { k: 'L', label: 'Cast List', el: 'note', writes: '[[ note ]]' },
  { k: 'N', label: 'New Act', el: 'section', writes: '# section' },
  { k: 'Q', label: 'Sequence', el: 'section2', writes: '## section' },
  { k: 'E', label: 'End of Act', el: 'centered', writes: '> centered <' },
  { k: '0', label: 'Summary', el: 'synopsis', writes: '= synopsis' },
  { k: '1', label: 'Outline 1', el: 'section', writes: '# section' },
  { k: '2', label: 'Outline 2', el: 'section2', writes: '## section' },
  { k: '3', label: 'Outline 3', el: 'section3', writes: '### section' },
  { k: '4', label: 'Note', el: 'note', writes: '[[ note ]]' },
  { k: 'O', label: 'Cold Opening', el: 'section', writes: '# section' },
  { k: 'W', label: 'Show/Ep. Title', el: 'centered', writes: '> centered <' },
];

// parse.js block.type -> element key for the current-element display. Types
// with no picker entry (e.g. 'page') fall back to Action.
export function elementOfBlock(block) {
  if (!block) return 'action';
  // Sections are one parser type carrying a level; the picker names each depth
  // separately, so a "## Sequence" must not report itself as "Section / Act".
  if (block.type === 'section') return block.level >= 3 ? 'section3' : block.level === 2 ? 'section2' : 'section';
  // A note is an inline run, not a block type, so a line that is nothing but a
  // note parses as action. Report what the writer actually put there.
  if (block.type === 'action' && /^\[\[[\s\S]*\]\]$/.test((block.text || '').trim())) return 'note';
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
  // Forced scene. The lookahead (rather than "a non-dot must follow") matters
  // for the empty case: Tab cycling puts a bare "." on an empty line for a
  // scene heading, and cycling on from there has to strip it back to nothing
  // instead of treating it as literal text and forcing it into "!.".
  if (/^\.(?!\.)/.test(s)) return s.slice(1).trim();
  if (s[0] === '@' || s[0] === '!' || s[0] === '~') return s.slice(1).trim(); // forced char/action/lyric
  if (s[0] === '>') return s.replace(/^>\s*/, '').trim();              // forced transition
  return s;
}

// What an EMPTY line has to already contain for the parser to read it as
// `key`. This is not cosmetic: the editor pins the element you picked, so
// without the markup the pin would claim "Lyric" over a line the file calls
// action, and the styling would snap back the instant you typed. Every entry
// here must survive stripForcing() back to '' so cycling off it leaves no junk.
const SEEDS = {
  scene: '.', action: '', character: '', dialogue: '',
  paren: '()', transition: '> ', centered: '>  <', lyric: '~',
  section: '# ', section2: '## ', section3: '### ', synopsis: '= ',
  note: '[[  ]]',
};

// Closing markup the caret has to stay inside, so what you type next lands
// between the delimiters instead of after them. Without this, picking
// Parenthetical gave you "()" with the caret past the ")" and typing produced
// "()quietly", which is not a parenthetical at all.
const SUFFIX = { paren: ')', centered: ' <', note: ' ]]' };

// A line holding nothing but an element's own markup: "(" ")", a bare ".", "~".
// Backspace clears the lot in one press rather than nibbling one delimiter off
// and leaving the line as broken markup.
export function isBareMarkup(raw) {
  const t = String(raw).trim();
  return t !== '' && stripForcing(t) === '';
}

// applyElement plus where the caret belongs in the result. Every caller that
// moves the caret should use this rather than assuming end-of-text.
export function applyElementTo(raw, key) {
  const text = applyElement(raw, key);
  const suf = SUFFIX[key] || '';
  return { text, caret: suf && text.endsWith(suf) ? text.length - suf.length : text.length };
}

// Rewrite one line's raw text so the parser reads it as `key`. Scene headings,
// characters and transitions are upper-cased (the "format as you go" part,
// point 4) -- itself valid Fountain. Forcing marks are only added when the
// plain text wouldn't otherwise parse as that element, so ordinary lines stay
// clean (no stray '!' on every action line).
export function applyElement(raw, key) {
  const c = stripForcing(raw);
  if (!c) {
    // Empty line: seed the markup that can't be inferred later. Character and
    // dialogue need none -- pinning the element (see cm-autoformat.js)
    // upper-cases what you type and the cue is recognised once dialogue
    // follows, so no stray '@'.
    return SEEDS[key] != null ? SEEDS[key] : '';
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
    case 'section2': return '## ' + c;
    case 'section3': return '### ' + c;
    case 'synopsis': return '= ' + c;
    case 'note': return '[[ ' + c + ' ]]';
    default: return c;
  }
}

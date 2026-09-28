// Pure Fountain parsing. No DOM. Lifted from the original single-file build
// (pandemonium_1.html) with behavior unchanged: this is the one source of
// truth for "what is a scene heading / character / dialogue block," and the
// CodeMirror decoration layer (src/components/editor) must drive off this
// same output rather than a second grammar, so the two never disagree about
// what the document means.
//
// Every block also carries position metadata (.line, .textOffset, and each
// run's .map, folded into .plainToRaw by parseFountain below) purely
// additive to the original output. This is what lets the CodeMirror layer
// translate a highlight anchor -- which is always expressed in terms of
// `.plain` (markup-delimiter-stripped text, so anchors survive `**bold**`
// being added/removed around them) -- back into an actual offset in the raw
// source text CodeMirror is editing, and vice versa for capturing a new
// selection as an anchor.
'use strict';

export const TITLE_KEYS = ['title', 'credit', 'author', 'authors', 'source', 'draft date', 'date', 'contact', 'copyright', 'notes'];

export const CONTENT_TYPES = { action: 1, dialogue: 1, paren: 1, centered: 1, lyric: 1, character: 1 };

// A character cue is an all-caps (or `@`-forced) line. Shared with the live
// decoration layer (cm-fountain-plugin.js) so its "the dialogue line is still
// blank" preview uses the exact same rule the parser will apply the instant
// that line gets real text, instead of a second, driftable heuristic.
export function isCharacterCueText(t) {
  const forcedChar = t[0] === '@';
  const core = (forcedChar ? t.slice(1) : t).replace(/\s*\^\s*$/, '');
  const strippedName = core.replace(/\([^)]*\)/g, '').trim();
  const isUpper = strippedName.length > 0 && strippedName === strippedName.toUpperCase() && /[A-Z]/.test(strippedName) && !/^\d+[.,!?]*$/.test(strippedName);
  return forcedChar || isUpper;
}

export function inlineRuns(text) {
  const runs = [];
  let b = false, it = false, u = false, note = false, buf = '', bufMap = [];
  const flush = () => { if (buf) { runs.push({ t: buf, b, i: it, u, n: note, map: bufMap }); buf = ''; bufMap = []; } };
  let k = 0;
  while (k < text.length) {
    if (text.startsWith('[[', k)) { flush(); note = true; k += 2; continue; }
    if (text.startsWith(']]', k)) { flush(); note = false; k += 2; continue; }
    if (text.startsWith('***', k)) { flush(); const on = !(b && it); b = on; it = on; k += 3; continue; }
    if (text.startsWith('**', k)) { flush(); b = !b; k += 2; continue; }
    if (text[k] === '*') { flush(); it = !it; k++; continue; }
    if (text[k] === '_') { flush(); u = !u; k++; continue; }
    if (text[k] === '\\' && k + 1 < text.length) { buf += text[k + 1]; bufMap.push(k + 1); k += 2; continue; }
    buf += text[k]; bufMap.push(k); k++;
  }
  flush();
  if (!runs.length) runs.push({ t: '', b: false, i: false, u: false, n: false, map: [] });
  return runs;
}

// Every boneyard (/* ... */) in the source, as [from, to) offsets in the
// document. The editor uses these to dim the boneyard where it stands
// (cm-fountain-plugin.js); the parser uses maskBoneyard, which is the same
// ranges blanked out.
export function boneyardRanges(src) {
  const out = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(String(src || '')))) out.push([m.index, m.index + m[0].length]);
  return out;
}

// The boneyard is not script, but it is still text sitting at real positions in
// the file. Blanking it IN PLACE -- every character a space, every newline
// kept -- takes it out of the parse without moving a single line or column, so
// block.line and block.textOffset still point at the real document.
//
// This used to cut the boneyard out of the string before splitting into lines,
// which shifted every block after a multi-line boneyard up by its line count:
// the editor then put the wrong element formatting on every line below it, the
// page layout counted the wrong rows, and every link anchor after it resolved
// to the wrong characters. Hard rule 2 calls that a bug, not an edge case.
export function maskBoneyard(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

export function parseFountain(src) {
  src = maskBoneyard(String(src || '').replace(/\r\n?/g, '\n'));
  const lines = src.split('\n');
  const title = {};
  const blocks = [];
  let i = 0;
  const m0 = lines[0] ? lines[0].match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/) : null;
  if (m0 && TITLE_KEYS.includes(m0[1].trim().toLowerCase())) {
    let key = null;
    while (i < lines.length && lines[i].trim() !== '') {
      const m = lines[i].match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
      if (m && TITLE_KEYS.includes(m[1].trim().toLowerCase())) { key = m[1].trim().toLowerCase(); title[key] = m[2].trim(); }
      else if (key) { title[key] = (title[key] ? title[key] + '\n' : '') + lines[i].trim(); }
      i++;
    }
  }
  let scene = 0;
  let lastBlank = true;
  // `b.text` is always a contiguous substring of `lines[i]` (every branch
  // below only trims a prefix and/or suffix off the raw line, never
  // reconstructs text from non-adjacent parts), so indexOf reliably finds
  // where it starts -- this is `.textOffset`, the raw-line offset of the
  // first character of `.text`.
  const push = (b) => {
    b.scene = scene; b.i = blocks.length; b.line = i;
    b.textOffset = b.text ? Math.max(0, lines[i].indexOf(b.text)) : 0;
    blocks.push(b);
  };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '') { lastBlank = true; i++; continue; }
    if (/^===+$/.test(t)) { push({ type: 'page', text: '' }); lastBlank = false; i++; continue; }
    // Fountain's forcing marks beat every automatic reading of a line. `!` is
    // "this is action whatever it looks like" and `~` is "this is a lyric", so
    // they have to be tested before the INT./EXT. and "... TO:" rules below,
    // not after them. Tested after, "!CUT TO:" parsed as a transition and
    // "!INT. HOUSE" as a scene heading -- which meant the element picker could
    // not turn a heading or a transition back into action at all, since `!` is
    // exactly what it writes to do that.
    if (t[0] === '!') { push({ type: 'action', text: t.slice(1) }); lastBlank = false; i++; continue; }
    if (t[0] === '~') { push({ type: 'lyric', text: t.slice(1) }); lastBlank = false; i++; continue; }
    const mSec = t.match(/^(#{1,6})\s*(.*)$/);
    if (mSec) { push({ type: 'section', level: mSec[1].length, text: mSec[2] }); lastBlank = false; i++; continue; }
    if (t[0] === '=') { push({ type: 'synopsis', text: t.slice(1).trim() }); lastBlank = false; i++; continue; }
    const forcedScene = t.length > 1 && t[0] === '.' && t[1] !== '.';
    if (forcedScene || /^(INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s]/i.test(t)) {
      scene++; push({ type: 'scene', text: (forcedScene ? t.slice(1) : t).trim() }); lastBlank = false; i++; continue;
    }
    if (/^>.*<$/.test(t)) { push({ type: 'centered', text: t.replace(/^>\s*/, '').replace(/\s*<$/, '') }); lastBlank = false; i++; continue; }
    if (t[0] === '>') { push({ type: 'transition', text: t.replace(/^>\s*/, '') }); lastBlank = false; i++; continue; }
    if (/TO:$/.test(t) && t === t.toUpperCase()) { push({ type: 'transition', text: t }); lastBlank = false; i++; continue; }
    const forcedChar = t[0] === '@';
    const core = (forcedChar ? t.slice(1) : t).replace(/\s*\^\s*$/, '');
    const nextNB = i + 1 < lines.length && lines[i + 1].trim() !== '';
    if (lastBlank && nextNB && isCharacterCueText(t)) {
      push({ type: 'character', text: core });
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        const dt = lines[i].trim();
        if (/^\(.*\)$/.test(dt)) push({ type: 'paren', text: dt });
        else push({ type: 'dialogue', text: dt });
        i++;
      }
      lastBlank = false; continue;
    }
    push({ type: 'action', text: t });
    lastBlank = false; i++;
  }
  for (const b of blocks) {
    b.runs = inlineRuns(b.text);
    b.plain = b.runs.map((r) => r.t).join('');
    b.words = b.plain.split(/\s+/).filter(Boolean).length;
    // plainToRaw[p] = offset within b.text of the character at b.plain[p].
    // Combined with b.line + b.textOffset, this maps any {s,e} range in
    // `.plain` (the shape every highlight anchor is stored in) to an actual
    // [from, to) range in the raw document CodeMirror edits.
    const plainToRaw = new Array(b.plain.length);
    let pos = 0;
    for (const r of b.runs) { for (const rawIdx of r.map) { plainToRaw[pos] = rawIdx; pos++; } }
    b.plainToRaw = plainToRaw;
  }
  return { title, blocks };
}

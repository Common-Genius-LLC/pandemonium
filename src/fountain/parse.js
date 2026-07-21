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

export function parseFountain(src) {
  src = String(src || '').replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
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
    if (t[0] === '~') { push({ type: 'lyric', text: t.slice(1) }); lastBlank = false; i++; continue; }
    if (t[0] === '!') { push({ type: 'action', text: t.slice(1) }); lastBlank = false; i++; continue; }
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

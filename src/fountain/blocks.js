// Block-level rendering and scene/coverage math. Pure, no DOM. Lifted from
// pandemonium_1.html unchanged. blockHTML() is used by the Phase 1 read-only
// preview; scenesOf()/sceneIndexOf() drive the timeline and are also read by
// the Phase 3 CodeMirror decoration layer, so scene numbering never diverges
// between the timeline and the editor.
'use strict';

import { esc } from '../utils/format.js';
import { CONTENT_TYPES } from './parse.js';

export { CONTENT_TYPES };

export function blockHTML(b, hls) {
  const plain = b.plain;
  const n = plain.length;
  if (n === 0) return '';
  const styleArr = new Array(n);
  const idsArr = new Array(n).fill(null);
  let pos = 0;
  for (const r of b.runs) {
    const st = (r.b ? 1 : 0) | (r.i ? 2 : 0) | (r.u ? 4 : 0) | (r.n ? 8 : 0);
    for (let c = 0; c < r.t.length; c++) { styleArr[pos] = st; pos++; }
  }
  if (hls) for (const h of hls) { for (let k = Math.max(0, h.s); k < Math.min(n, h.e); k++) { if (!idsArr[k]) idsArr[k] = []; idsArr[k].push(h); } }
  let out = '', seg = '', curKey = null, curStyle = 0, curH = null;
  const keyAt = (k) => styleArr[k] + '|' + (idsArr[k] ? idsArr[k].map((h) => h.kind + ':' + h.id).join(',') : '');
  const emit = () => {
    if (seg === '') return;
    let open = '', close = '';
    if (curStyle & 8) { open += '<span class="note">'; close = '</span>' + close; }
    if (curStyle & 1) { open += '<b>'; close = '</b>' + close; }
    if (curStyle & 2) { open += '<i>'; close = '</i>' + close; }
    if (curStyle & 4) { open += '<u>'; close = '</u>' + close; }
    let inner = esc(seg);
    if (curH && curH.length) {
      const cls = [...new Set(curH.map((h) => h.cls))].join(' ');
      const idAttr = curH.map((h) => h.kind + ':' + h.id).join(' ');
      inner = '<mark class="' + cls + '" data-hl="' + idAttr + '">' + inner + '</mark>';
    }
    out += open + inner + close; seg = '';
  };
  for (let k = 0; k < n; k++) {
    const kk = keyAt(k);
    if (kk !== curKey) { emit(); curKey = kk; curStyle = styleArr[k]; curH = idsArr[k] ? idsArr[k].slice() : null; }
    seg += plain[k];
  }
  emit();
  return out;
}

export function scenesOf(parsed) {
  const scenes = [];
  let cur = null;
  for (const b of parsed.blocks) {
    if (b.type === 'scene') { cur = { name: b.plain || 'Scene', start: b.i, end: b.i, dw: 0, aw: 0, content: 0 }; scenes.push(cur); continue; }
    if (!cur) { cur = { name: 'Opening', start: b.i, end: b.i, dw: 0, aw: 0, content: 0, pre: true }; scenes.push(cur); }
    cur.end = b.i;
    if (CONTENT_TYPES[b.type]) cur.content++;
    if (b.type === 'dialogue' || b.type === 'lyric') cur.dw += b.words;
    else if (b.type === 'action' || b.type === 'centered' || b.type === 'paren') cur.aw += b.words;
  }
  for (const sc of scenes) { sc.secs = (sc.dw || sc.aw) ? Math.max(2, sc.dw / 2.4 + sc.aw / 4.5) : 2; }
  if (!scenes.length) scenes.push({ name: 'Script', start: 0, end: -1, dw: 0, aw: 0, content: 0, secs: 0 });
  return scenes;
}

export function sceneIndexOf(scenes, bi) {
  for (let k = scenes.length - 1; k >= 0; k--) { if (bi >= scenes[k].start) return k; }
  return 0;
}

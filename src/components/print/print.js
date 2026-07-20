// Print/export: builds a plain HTML string into the light-DOM #printRoot
// (see styles/global.css for why it must live outside every shadow root)
// and calls window.print(). Ported from the original doPrint()/printScript()
// /printBoards(). Not a Lit component -- there is nothing reactive about it,
// it runs once per export click.
'use strict';

import { esc } from '../../utils/format.js';

function printInline(b) {
  let out = '';
  for (const r of b.runs) {
    if (r.n || !r.t) continue;
    let open = '', close = '';
    if (r.b) { open += '<b>'; close = '</b>' + close; }
    if (r.i) { open += '<i>'; close = '</i>' + close; }
    if (r.u) { open += '<u>'; close = '</u>' + close; }
    out += open + esc(r.t) + close;
  }
  return out;
}

function doPrint(mode, html) {
  const root = document.getElementById('printRoot');
  if (!root) return;
  root.className = mode;
  root.innerHTML = html;
  const clean = () => { root.innerHTML = ''; root.className = ''; window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  setTimeout(() => {
    try { window.print(); }
    catch (err) { console.error(err); }
  }, 60);
  setTimeout(clean, 15000);
}

export function printScript(script, parsed) {
  const T = parsed.title;
  let html = '';
  if (T.title) {
    html += '<div class="ptitle"><div class="t">' + esc(T.title) + '</div>' +
      (T.credit ? '<div>' + esc(T.credit) + '</div>' : '') +
      ((T.author || T.authors) ? '<div>' + esc(T.author || T.authors) + '</div>' : '') +
      (T['draft date'] ? '<div style="margin-top:24pt">' + esc(T['draft date']) + '</div>' : '') +
      (T.contact ? '<div style="margin-top:24pt;white-space:pre-wrap">' + esc(T.contact) + '</div>' : '') +
      '</div>';
  }
  for (const b of parsed.blocks) {
    if (b.type === 'section' || b.type === 'synopsis') continue;
    if (b.type === 'page') { html += '<div class="p-page"></div>'; continue; }
    html += '<div class="pb p-' + b.type + '">' + (printInline(b) || '&nbsp;') + '</div>';
  }
  doPrint('mode-script', html);
}

export function printBoards(finalState, projectName) {
  const arr = finalState.R.boards.slice().sort((a, b) => a.firstBi - b.firstBi);
  if (!arr.length) return false;
  let html = '<div class="bh">' + esc(projectName) + ' · Storyboards · ' + esc(finalState.fsc.name) + '</div><div class="grid">';
  for (const o of arr) {
    const q = ((o.bd.anchor.parts[0] && o.bd.anchor.parts[0].q) || '').slice(0, 140);
    const scn = o.ok ? finalState.fscenes[o.sceneIdx] : null;
    html += '<div class="cell">' +
      (o.bd.img ? '<img src="' + o.bd.img + '">' : '<div class="noimg"></div>') +
      '<div class="cap">' + (scn ? esc(scn.pre ? 'Opening' : 'Sc ' + scn.label) + ' · ' : '') + esc(o.bd.caption || '') + '</div>' +
      '<div class="q">' + esc(q) + '</div></div>';
  }
  html += '</div>';
  doPrint('mode-boards', html);
  return true;
}

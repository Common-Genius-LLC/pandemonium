// Research doc bodies are free text, not Fountain -- paragraphs split on a
// blank line, each rendered/resolved the same way a script block is (reusing
// blockHTML + resolvePart with a one-run "block"), just without any of the
// scene/character/dialogue typing. Pulled out of the original renderReader().
'use strict';

export function docParas(doc) {
  return String(doc.body || '').split(/\n{2,}/).map((s) => s.replace(/^\n+|\n+$/g, ''));
}

export function paraAsBlock(text) {
  return { plain: text, runs: [{ t: text, b: false, i: false, u: false, n: false }] };
}

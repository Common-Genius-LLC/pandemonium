// Anchor resolution: a highlight is stored as {q: quoted substring, b: the
// block index it was captured in, s: offset within that block's plain text},
// never as a fixed range. On every render we re-search for that quote,
// starting at block b and expanding outward, so edits elsewhere in the
// document don't sever a link; a link only goes "lost" when the quoted text
// can no longer be found anywhere. Do not change this to offset-based
// anchoring, it is what makes editing safe. Pure, no DOM.
'use strict';

import { clamp } from '../utils/format.js';

export function resolvePart(plains, part) {
  if (!part || !part.q) return null;
  const q = part.q;
  const b = typeof part.b === 'number' ? part.b : 0;
  const N = plains.length;
  if (!N) return null;
  const start = clamp(b, 0, N - 1);
  for (let d = 0; d < N; d++) {
    for (const bi of (d === 0 ? [start] : [start - d, start + d])) {
      if (bi < 0 || bi >= N) continue;
      const p = plains[bi];
      if (!p) continue;
      let idx = -1;
      if (bi === b && typeof part.s === 'number' && p.startsWith(q, part.s)) idx = part.s;
      else idx = p.indexOf(q);
      if (idx >= 0) return { bi, s: idx, e: idx + q.length };
    }
  }
  return null;
}

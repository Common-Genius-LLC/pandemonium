// Converts a CodeMirror selection range (raw document offsets) into the
// same {q, b, s} anchor-part shape the old DOM-based captureParts()
// produced -- the inverse of doc-map.js's plainRangeToRaw, used for
// resolving anchors back onto the document. Pure, no CodeMirror import
// (works against anything with a CM6-shaped `doc.line(n)`/`doc.lines`).
'use strict';

import { blockRawRange, rawOffsetToPlainPos } from '../../fountain/doc-map.js';

export function captureFromSelection(parsed, doc, from, to) {
  if (from === to) return null;
  const parts = [];
  for (const b of parsed.blocks) {
    if (b.type === 'page' || b.line == null || b.line + 1 > doc.lines) continue;
    const line = doc.line(b.line + 1);
    const { from: bFrom, to: bTo } = blockRawRange(b, line.from);
    const ovFrom = Math.max(from, bFrom);
    const ovTo = Math.min(to, bTo);
    if (ovFrom >= ovTo) continue;
    const ps = rawOffsetToPlainPos(b, line.from, ovFrom, true);
    const pe = rawOffsetToPlainPos(b, line.from, ovTo, false);
    if (pe <= ps) continue;
    const q = b.plain.slice(ps, pe);
    if (!q.trim()) continue;
    parts.push({ q, b: b.i, s: ps });
  }
  return parts.length ? parts : null;
}

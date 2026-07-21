// Bridges a block's plain-text offsets (the space every highlight anchor
// and resolvePart() operate in) and its actual position in the raw
// CodeMirror document (the space decorations and selections operate in).
// Built on the position metadata parse.js now attaches to every block
// (.line, .textOffset, .plainToRaw). Pure, no DOM, no CodeMirror import --
// callers pass in `lineFrom` (the document offset of the start of the
// block's line) so this stays testable without spinning up an editor.
'use strict';

// Plain-offset position -> raw document offset. `plainPos` may be
// `plain.length` (one past the end) to get the offset just after the last
// character of a range.
export function plainPosToRaw(block, lineFrom, plainPos) {
  const map = block.plainToRaw;
  const base = lineFrom + block.textOffset;
  if (!map.length) return base;
  if (plainPos <= 0) return base + map[0];
  if (plainPos >= map.length) return base + map[map.length - 1] + 1;
  return base + map[plainPos];
}

export function plainRangeToRaw(block, lineFrom, s, e) {
  return { from: plainPosToRaw(block, lineFrom, s), to: plainPosToRaw(block, lineFrom, e) };
}

// Raw document offset (already known to fall within this block's raw
// range) -> plain offset. `ceil` finds the first plain character at or
// after the raw position (used for a selection's start, so landing on a
// stripped delimiter snaps forward into content); floor (ceil:false) finds
// the plain offset just after the last plain character at or before the
// raw position (used for a selection's end).
export function rawOffsetToPlainPos(block, lineFrom, rawPos, ceil) {
  const map = block.plainToRaw;
  const rel = rawPos - lineFrom - block.textOffset;
  if (!map.length) return 0;
  if (ceil) {
    for (let p = 0; p < map.length; p++) { if (map[p] >= rel) return p; }
    return map.length;
  }
  for (let p = map.length - 1; p >= 0; p--) { if (map[p] <= rel) return p + 1; }
  return 0;
}

// The block's full raw-text span in the document, e.g. to know whether a
// selection range intersects this block at all.
export function blockRawRange(block, lineFrom) {
  const from = lineFrom + block.textOffset;
  return { from, to: from + block.text.length };
}

// Ranges (relative to the start of block.text) of the inline syntax that the
// parser stripped -- the `**`/`*`/`_` emphasis delimiters, `[[ ]]` note
// brackets, escape backslashes: every raw offset in block.text that is NOT a
// plain character (plainToRaw lists the ones that are). Used by the live
// preview to conceal/dim those delimiters. Pure.
export function inlineDelimRanges(block) {
  const kept = new Set(block.plainToRaw);
  const ranges = [];
  const n = block.text.length;
  let start = -1;
  for (let r = 0; r < n; r++) {
    if (!kept.has(r)) { if (start < 0) start = r; }
    else if (start >= 0) { ranges.push([start, r]); start = -1; }
  }
  if (start >= 0) ranges.push([start, n]);
  return ranges;
}

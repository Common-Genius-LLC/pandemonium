// The divider between the picture and the script strip in the preview. Pure
// arithmetic, kept out of the component so it can be tested and so the
// component reads as layout rather than sums.
//
// A split is the fraction of the screen's height the script strip takes; the
// picture gets the rest and is fitted into it (never cropped, see the
// slideshow's .stage). The strip is drawn at DEFAULT_SPLIT unless the writer
// has moved it.
'use strict';

export const DEFAULT_SPLIT = 0.3;
export const MIN_SPLIT = 0.12;
export const MAX_SPLIT = 0.7;

export function clampSplit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SPLIT;
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, n));
}

// Where a drag puts the split: the pointer's distance from the bottom edge, as
// a fraction of the screen. `top` and `height` describe the show's box.
export function splitFromPointer(clientY, top, height) {
  if (!(height > 0)) return DEFAULT_SPLIT;
  return clampSplit((top + height - clientY) / height);
}

// How much the script type grows or shrinks with the strip. The type's own
// size already steps down as a passage gets longer (slideshow #lineSize); this
// scales that with the room it has. Square root, not the ratio: the strip only
// changes in height while its width stays, and text needs room in proportion
// to the SQUARE of its size, so this is the scale at which what fitted at the
// default still fits.
export function textScale(split) {
  return Math.min(1.9, Math.max(0.6, Math.sqrt(clampSplit(split) / DEFAULT_SPLIT)));
}

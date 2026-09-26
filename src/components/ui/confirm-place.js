// Where the confirmation bubble (Figma "Delete Dialogue box", node 144-423)
// goes relative to the control that asked. Pure arithmetic, kept out of the
// component so it can be tested and so the component reads as markup.
//
// The bubble is a fixed shape (a rounded box with a pointer notch), so the
// pointer is not free to slide: the box is moved so the pointer's tip sits under
// the middle of the control, then held inside the viewport. Where the box has to
// be held back (a narrow window) the pointer ends up off centre, which is the
// lesser fault next to a bubble that runs off the screen.
'use strict';

// The vector's own measurements, from the Figma export: the whole shape, how
// far the pointer's tip is from the left edge, and how tall the pointer is
// (the box proper starts that far below the top of the shape).
export const BUBBLE = { w: 213.237, h: 102.707, tip: 105.475, point: 13.773 };

// `anchor` is the control's viewport rect ({left, right, top, bottom}) and
// `view` the viewport ({width, height}). Below the control by default, above it
// (the shape flipped, pointer at the bottom) when there is no room below and
// there is above; where neither fits, the side with more room, held on screen.
export function placeBubble(anchor, view, { gap = 8, margin = 8 } = {}) {
  const { w, h, tip } = BUBBLE;
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.max(margin, Math.min(center - tip, view.width - w - margin));

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - h;
  const fitsBelow = below + h + margin <= view.height;
  const fitsAbove = above >= margin;

  let side = 'below';
  if (!fitsBelow) {
    if (fitsAbove) side = 'above';
    else side = view.height - anchor.bottom >= anchor.top ? 'below' : 'above';
  }

  const raw = side === 'below' ? below : above;
  const top = Math.max(margin, Math.min(raw, view.height - h - margin));
  return { left, top, side };
}

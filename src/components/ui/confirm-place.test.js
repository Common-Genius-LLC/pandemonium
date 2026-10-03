// The confirmation bubble's placement arithmetic.
'use strict';

import { describe, it, expect } from 'vitest';
import { BUBBLE, placeBubble, anchorRect, centerOf } from './confirm-place.js';

const VIEW = { width: 1200, height: 800 };
const rect = (left, top, w = 56, h = 24) => ({ left, top, right: left + w, bottom: top + h });

describe('placeBubble', () => {
  it('puts the pointer tip under the middle of the control, below it', () => {
    const a = rect(500, 200);
    const p = placeBubble(a, VIEW);
    expect(p.side).toBe('below');
    expect(p.left + BUBBLE.tip).toBeCloseTo(528);
    expect(p.top).toBe(a.bottom + 8);
  });

  it('holds the box inside the viewport on the left and the right', () => {
    expect(placeBubble(rect(0, 200), VIEW).left).toBe(8);
    expect(placeBubble(rect(1180, 200), VIEW).left).toBeCloseTo(VIEW.width - BUBBLE.w - 8);
  });

  it('flips above the control when there is no room below but there is above', () => {
    const a = rect(500, 740);
    const p = placeBubble(a, VIEW);
    expect(p.side).toBe('above');
    expect(p.top).toBeCloseTo(a.top - 8 - BUBBLE.h);
  });

  it('stays below when it fits with a pixel to spare', () => {
    const a = rect(500, VIEW.height - 8 - BUBBLE.h - 8 - 24 - 1);
    expect(placeBubble(a, VIEW).side).toBe('below');
  });

  it('takes the roomier side, held on screen, when neither fits', () => {
    const short = { width: 1200, height: 150 };
    const nearTop = placeBubble(rect(500, 20), short);
    expect(nearTop.side).toBe('below');
    expect(nearTop.top).toBeGreaterThanOrEqual(8);
    expect(nearTop.top + BUBBLE.h).toBeLessThanOrEqual(short.height - 8 + 0.001);

    const nearBottom = placeBubble(rect(500, 110), short);
    expect(nearBottom.side).toBe('above');
    expect(nearBottom.top).toBeGreaterThanOrEqual(8);
  });
});

// What a question points at, when the control that asked has gone (a menu row
// that closed) and the thing it is about is all there is left.
describe('anchors', () => {
  it('takes a rect as it stands', () => {
    const r = rect(10, 20);
    expect(anchorRect(r)).toBe(r);
    expect(anchorRect(null)).toBe(null);
  });
  it('measures an element', () => {
    const el = { getBoundingClientRect: () => rect(10, 20) };
    expect(anchorRect(el)).toEqual(rect(10, 20));
  });
  it('turns an element into its own middle, with no size', () => {
    const el = { getBoundingClientRect: () => rect(100, 200, 60, 40) };
    expect(centerOf(el)).toEqual({ left: 130, right: 130, top: 220, bottom: 220 });
  });
  it('points the tip at that middle', () => {
    const el = { getBoundingClientRect: () => rect(100, 200, 60, 40) };
    const p = placeBubble(centerOf(el), VIEW);
    expect(p.left + BUBBLE.tip).toBeCloseTo(130);
    expect(p.top).toBeCloseTo(228);
  });
});

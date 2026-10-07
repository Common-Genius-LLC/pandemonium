// The key colour: the one colour that stands for a frame.
//
// Every case here is a frame built out of flat regions, so the answer can be
// reasoned about from the regions rather than from a photograph: a frame that
// is one colour must come back as exactly that colour, and a frame of two must
// come back between them, nearer the one that carries the frame.
'use strict';

import { describe, it, expect } from 'vitest';
import { keyColorFromPixels, readableKeyColor, SIZE } from './key-color.js';

// A frame of SIZE x SIZE RGBA, painted background first, then `share` of the
// pixels (as a fraction of the whole) in the subject's colour.
function frame(bg, subject = null, share = 0) {
  const n = SIZE * SIZE;
  const data = new Uint8ClampedArray(n * 4);
  const count = Math.round(n * share);
  for (let i = 0; i < n; i++) {
    const c = subject && i < count ? subject : bg;
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const luma = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// Positive where the colour leans warm (red/yellow), negative where it leans
// cool (cyan/blue). Enough to say which half of the wheel an answer is on.
const warmth = (hex) => { const [r, g, b] = rgb(hex); return r - b; };

describe('a frame of one colour is that colour', () => {
  it('black is black', () => {
    expect(keyColorFromPixels(frame([0, 0, 0]))).toBe('#000000');
  });

  it('a near-black frame keeps its own near-black', () => {
    expect(keyColorFromPixels(frame([7, 7, 8]))).toBe('#070708');
  });

  it('a flat grey is that grey, not a hue read out of the noise', () => {
    expect(keyColorFromPixels(frame([106, 106, 106]))).toBe('#6a6a6a');
  });

  it('a saturated fill is itself', () => {
    expect(keyColorFromPixels(frame([200, 40, 35]))).toBe('#c82823');
  });

  it('a deep night blue is itself, however dark', () => {
    expect(keyColorFromPixels(frame([20, 30, 70]))).toBe('#141e46');
  });
});

describe('a mostly black frame', () => {
  // The bug this file was written for: a frame of hands lit in a dark room
  // came back the faint cool cast of the room (or, when the read gave up, the
  // fallback green), because 85% of the pixels were that room and every
  // pixel's hue counted the same however little light was in it.
  it('takes the colour of what is lit in it, kept dark', () => {
    const out = keyColorFromPixels(frame([4, 12, 14], [155, 101, 50], 0.15));
    expect(warmth(out)).toBeGreaterThan(20); // warm, not the room's cool cast
    expect(luma(out)).toBeLessThan(luma('#9b6532')); // and darker than the lit part itself
  });

  it('is still black when there is nothing lit in it', () => {
    expect(keyColorFromPixels(frame([0, 0, 0], [0, 0, 0], 0.2))).toBe('#000000');
  });

  it('is not carried off by a speck: one per cent of red keeps the frame dark', () => {
    const out = keyColorFromPixels(frame([0, 0, 0], [220, 30, 20], 0.01));
    expect(luma(out)).toBeLessThan(30);
    expect(warmth(out)).toBeGreaterThan(0); // but it does lean that way
  });

  it('answers the same for a frame that is a shade darker', () => {
    // The old gate was an absolute chroma, so two frames a shade apart could
    // fall either side of it and come out unalike. Nothing here has an edge.
    const a = keyColorFromPixels(frame([4, 12, 14], [155, 101, 50], 0.15));
    const b = keyColorFromPixels(frame([3, 9, 11], [140, 91, 45], 0.15));
    expect(Math.abs(warmth(a) - warmth(b))).toBeLessThan(25);
  });
});

describe('two colours do not cancel', () => {
  it('a red subject on a cyan wall is one of them, never the grey between', () => {
    const out = keyColorFromPixels(frame([30, 160, 170], [200, 40, 35], 0.16));
    const [r, g, b] = rgb(out);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(40); // it kept a hue
  });

  it('a teal and orange frame reads the lit half, orange', () => {
    const out = keyColorFromPixels(frame([26, 72, 84], [214, 128, 62], 0.45));
    expect(warmth(out)).toBeGreaterThan(40);
  });

  it('a blue sky with snow under it stays blue', () => {
    const out = keyColorFromPixels(frame([96, 158, 214], [250, 250, 252], 0.3));
    expect(warmth(out)).toBeLessThan(-30);
  });
});

describe('what cannot be read', () => {
  it('a fully transparent frame has no colour', () => {
    expect(keyColorFromPixels(new Uint8ClampedArray(SIZE * SIZE * 4))).toBe(null);
  });

  it('an empty buffer has no colour', () => {
    expect(keyColorFromPixels(new Uint8ClampedArray(0))).toBe(null);
  });

  it('a transparent surround is skipped, not read as the canvas behind it', () => {
    const data = frame([0, 0, 0], [200, 40, 35], 0.25);
    for (let i = 0; i < SIZE * SIZE; i++) if (data[i * 4 + 3] === 255 && i >= SIZE * SIZE * 0.25) data[i * 4 + 3] = 0;
    expect(keyColorFromPixels(data)).toBe('#c82823');
  });
});

describe('the answer is always a colour in the frame', () => {
  it('never falls outside the range of what it averaged', () => {
    const out = keyColorFromPixels(frame([26, 72, 84], [214, 128, 62], 0.5));
    const [r, g, b] = rgb(out);
    expect(r).toBeGreaterThanOrEqual(26);
    expect(r).toBeLessThanOrEqual(214);
    expect(g).toBeGreaterThanOrEqual(72);
    expect(g).toBeLessThanOrEqual(128);
    expect(b).toBeGreaterThanOrEqual(62);
    expect(b).toBeLessThanOrEqual(84);
  });

  it('is a six-digit hex for every frame it can read', () => {
    for (const bg of [[0, 0, 0], [255, 255, 255], [1, 2, 3], [254, 1, 128]]) {
      expect(keyColorFromPixels(frame(bg))).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('readableKeyColor', () => {
  // A storyboard drawn in pencil on white paper has a near-white key colour,
  // which is true of the frame and useless on a pale track: the bar would say
  // nothing is there. It comes down to the same grey an uncoloured bar uses.
  it('brings paper white down to a grey', () => {
    const out = readableKeyColor('#ffffff');
    const [r, g, b] = rgb(out);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(3); // still grey
    // Darker than --note-plain-dot, the grey a storyboard with no frame takes,
    // so a beat that is drawn does not read as a beat that is only claimed.
    expect(luma(out)).toBeLessThan(luma('#b0b0b0'));
  });

  it('brings a pencil drawing on white down with it', () => {
    expect(luma(readableKeyColor('#f4f2ef'))).toBeLessThan(luma('#d9d9d9')); // darker than the empty track
  });

  it('keeps the hue of a pale colour, only its lightness gives way', () => {
    const out = readableKeyColor('#fdf3d0'); // pale yellow
    const [r, , b] = rgb(out);
    expect(r).toBeGreaterThan(b); // still yellow
    expect(luma(out)).toBeLessThan(luma('#fdf3d0'));
  });

  it('leaves everything that is already readable exactly as it was', () => {
    for (const c of ['#000000', '#4b311c', '#6a6a6a', '#b53c29', '#78a849']) {
      expect(readableKeyColor(c)).toBe(c);
    }
  });

  it('passes anything that is not a colour straight through', () => {
    expect(readableKeyColor('')).toBe('');
    expect(readableKeyColor(null)).toBe(null);
    expect(readableKeyColor('var(--board)')).toBe('var(--board)');
  });
});

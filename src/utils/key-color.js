// A frame's key colour: the one colour that stands for it.
//
// The timeline's Storyboard row draws every boarded beat in the key colour of
// its own frame, so the row reads as the film's palette down its length: where
// it goes warm, where it goes cold, where it goes grey. A thumbnail at that
// size would be a smear (a bar is often two or three pixels wide); the colour
// of the thumbnail is the part that survives.
//
// HOW IT IS CHOSEN. One weighted average over every pixel, where a pixel's
// weight is how much colour it carries. There is no threshold anywhere in it
// and nothing is discarded, so two frames that look alike cannot come out
// unalike:
//
//   weight = BASE + chroma * visible(lightness) * agrees(hue)
//
//   * BASE is the vote every pixel has in the frame's overall level, so a
//     frame with no colour in it (black, grey, a black-and-white still) comes
//     out as its own plain average, which is the honest answer for it.
//   * chroma is measured in Oklab, where it means the same thing at every
//     lightness. In plain RGB, max-min, it does not: a deep warm brown reads
//     as almost no chroma next to a pale sky, so a night frame could never
//     win its own colour. That is what made a dark frame's answer jump about.
//   * visible() silences what cannot carry a hue: pixels so near black that
//     their colour is only compression noise, and blown highlights.
//   * agrees() silences the opposite hue, so a red subject on a cyan wall
//     cannot average into grey. The dominant hue is found first, from a
//     histogram of the same chroma-by-visibility weight.
//
// Because BASE is small beside a real colour, a frame that is mostly black
// with one lit subject comes out as a dark reading of that subject rather than
// as the mud a flat average gives: the lit part outvotes the dark part without
// ever being brighter than it really is. A frame that is black and nothing
// else comes out black. A frame with a single tiny speck of colour keeps the
// frame's own darkness, because one speck cannot outvote the whole frame.
//
// The average is taken in Oklab and converted back, so the result is a real
// mixture of the frame's own colours and never a hue that is not in it.
//
// Fully transparent pixels are skipped: a PNG with a transparent surround
// would otherwise read as whatever the canvas was cleared to.
//
// Asynchronous, cached by the image's own data (the data URL string is the
// key, so two boards holding the same frame share one answer), and never
// stored in the project: it is derived from the image and can always be
// derived again.
'use strict';

// The frame is read at 32x32. 16 was too coarse: a lit face against a dark
// room can land in three or four cells there, and whatever the downscale did
// to it was the whole evidence. 1024 cells is still nothing to average.
export const SIZE = 32;

// Every pixel's unconditional vote in the frame's level, against an Oklab
// chroma of about .06 for a skin tone and .26 for a saturated red. At this
// ratio a subject holding a real colour across a few per cent of the frame
// carries the answer, and a speck does not.
const BASE = 0.0015;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// What a pixel's hue is worth: the light it actually puts out. Oklab's L is a
// cube root of that light, so cubing it undoes the root and gives back the
// pixel's share of what the eye receives, measured against a mid-tone. That
// one line is what keeps a dark room dark: a frame of hands lit in the black
// is 85% unlit room, and the room's own faint cool cast outnumbers the hands
// by two to one when every pixel's hue counts the same. Cubed, the hands carry
// four times the room, because they are where the light is. Blown highlights
// are held back at the other end: that white is the sensor, not the thing.
function visible(L) {
  const lit = clamp01(L / 0.5) ** 3;
  const unblown = 0.3 + 0.7 * clamp01((1 - L) / 0.15);
  return lit * unblown;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// sRGB 0..255 to Oklab. (Bjorn Ottosson's matrices.)
function toOklab(r8, g8, b8) {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  ];
}

function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

// The hue the frame is about: the peak of a 24-bucket histogram of chroma by
// visibility, smoothed around the circle so a hue sitting on a bucket edge is
// not split in two, then the weighted mean of the peak and its neighbours.
const BUCKETS = 24;
const SMOOTH = [1, 2, 3, 2, 1];
// Below this the frame has no hue worth favouring (a grey, a black-and-white
// still) and every pixel agrees with every other.
const HUE_FLOOR = 1e-4;

function dominantHue(px) {
  const hist = new Float64Array(BUCKETS);
  for (const p of px) {
    if (p.c <= 0) continue;
    const h = Math.atan2(p.b, p.a);
    const bi = Math.floor(((h + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    hist[bi] += p.c * p.vis;
  }
  const soft = new Float64Array(BUCKETS);
  let total = 0;
  for (let i = 0; i < BUCKETS; i++) {
    for (let k = 0; k < SMOOTH.length; k++) {
      soft[i] += SMOOTH[k] * hist[(i + k - 2 + BUCKETS) % BUCKETS];
    }
    total += hist[i];
  }
  if (total / px.length < HUE_FLOOR) return null;
  let peak = 0;
  for (let i = 1; i < BUCKETS; i++) if (soft[i] > soft[peak]) peak = i;
  // The circular mean of the peak and the bucket either side, taken from the
  // pixels themselves rather than from the bucket centres.
  let ax = 0;
  let ay = 0;
  for (const p of px) {
    if (p.c <= 0) continue;
    const h = Math.atan2(p.b, p.a);
    const bi = Math.floor(((h + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    const d = Math.min((bi - peak + BUCKETS) % BUCKETS, (peak - bi + BUCKETS) % BUCKETS);
    if (d > 1) continue;
    const w = p.c * p.vis;
    ax += Math.cos(h) * w;
    ay += Math.sin(h) * w;
  }
  return ax === 0 && ay === 0 ? null : Math.atan2(ay, ax);
}

// The key colour of one frame's pixels: RGBA bytes in, '#rrggbb' out, or null
// when there is nothing opaque to read (a fully transparent image, or a draw
// that silently produced nothing).
export function keyColorFromPixels(data) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // transparent
    const lab = toOklab(data[i], data[i + 1], data[i + 2]);
    const c = Math.hypot(lab.a, lab.b);
    px.push({ L: lab.L, a: lab.a, b: lab.b, c, vis: visible(lab.L) });
  }
  if (!px.length) return null;

  const h0 = dominantHue(px);
  let wsum = 0;
  let L = 0;
  let A = 0;
  let B = 0;
  for (const p of px) {
    let colour = p.c * p.vis;
    if (h0 != null && colour > 0) {
      // ((1 + cos d) / 2) squared: the opposite hue contributes nothing beyond
      // its BASE vote, a neighbouring hue nearly all of its own.
      const agree = (1 + Math.cos(Math.atan2(p.b, p.a) - h0)) / 2;
      colour *= agree * agree;
    }
    const w = BASE + colour;
    wsum += w;
    L += p.L * w;
    A += p.a * w;
    B += p.b * w;
  }
  const [r, g, b] = fromOklab(L / wsum, A / wsum, B / wsum);
  return '#' + hex2(r) + hex2(g) + hex2(b);
}

// A frame drawn on white paper has a near-white key colour, and that is the
// true answer for it: the frame really is mostly paper. It is not a usable one
// on the timeline, where a near-white bar on a pale track says "nothing here"
// when something is there. So a colour on its way to a bar is held at or below
// this lightness, hue and relative chroma kept, which turns a pencil sketch on
// white into a plain grey and leaves everything darker exactly as it was.
// Oklab L .68 is a step darker than --note-plain-dot, which is the grey a
// storyboard with no frame in it at all takes: the two states are both grey,
// as they should be, but a beat someone has drawn still reads darker than a
// beat someone has only claimed.
const BAR_MAX_L = 0.68;

export function readableKeyColor(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const { L, a, b } = toOklab(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
  if (L <= BAR_MAX_L) return hex;
  // Scale a and b by the same factor as L, so the hue holds and the colour
  // darkens the way a colour does rather than gaining saturation.
  const k = BAR_MAX_L / L;
  const [r, g, bl] = fromOklab(BAR_MAX_L, a * k, b * k);
  return '#' + hex2(r) + hex2(g) + hex2(bl);
}

const cache = new Map(); // src -> '#rrggbb' | null (null: nothing could be read)
const inFlight = new Map(); // src -> Promise
const failed = new Map(); // src -> how many times the decode itself failed

// A frame is a photograph, often straight off a phone, and a project can hold
// dozens. Decoding them all in the same tick is how a browser runs out of room
// and starts refusing, which used to leave those bars on the fallback green
// for good. Four at a time costs nothing on a short list and holds a long one.
const LANES = 4;
let running = 0;
const queue = [];

function pump() {
  while (running < LANES && queue.length) {
    running++;
    const next = queue.shift();
    // Promise.resolve() so that a job throwing where it stands still frees its
    // lane: a lane that is never given back stops every frame behind it.
    Promise.resolve().then(next).finally(() => { running--; pump(); });
  }
}

function lane(job) {
  return new Promise((resolve) => {
    queue.push(() => job().then(resolve, () => resolve(null)));
    pump();
  });
}

// Reduce by halves to within 2x of the target before the last draw. A single
// draw from 4000px to 32px asks the engine for a 125:1 reduction, which it is
// free to do by sampling: a lit face a few pixels wide can fall between the
// samples and never reach the average at all. Halving guarantees every source
// pixel reaches it.
function drawDownscaled(source, width, height, ctx) {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  let src = source;
  let step = null; // the intermediate canvas src currently points at, if any
  const release = (c) => { if (c) { c.width = 0; c.height = 0; } }; // now, not at the next collection
  while (w > SIZE * 2 || h > SIZE * 2) {
    const nw = Math.max(SIZE, Math.round(w / 2));
    const nh = Math.max(SIZE, Math.round(h / 2));
    if (nw === w && nh === h) break; // already as small as the halving can take it
    const next = document.createElement('canvas');
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext('2d');
    if (!nctx) break;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(src, 0, 0, w, h, 0, 0, nw, nh);
    release(step);
    src = next;
    step = next;
    w = nw;
    h = nh;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h, 0, 0, SIZE, SIZE);
  release(step);
}

// Draws the frame small and reads it back. Returns null (rather than a colour)
// only when there was nothing to read: the caller treats that as "ask again",
// since a decode that quietly produced nothing is usually a passing shortage
// of memory rather than a property of the image.
function readKeyColor(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (!width || !height) return null;
  drawDownscaled(source, width, height, ctx);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  return keyColorFromPixels(data);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    // Only matters for an http(s) frame; a data URL is same-origin anyway, and
    // without this a remote one would taint the canvas and getImageData would
    // throw rather than return.
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// The second way in. createImageBitmap decodes on its own thread and at a size
// we choose, so it can answer where an <img> under memory pressure did not.
async function readViaBitmap(src) {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return null;
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return readKeyColor(bitmap, bitmap.width, bitmap.height);
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

async function read(src) {
  const img = await loadImage(src);
  if (img && img.naturalWidth && img.naturalHeight) {
    try {
      const out = readKeyColor(img, img.naturalWidth, img.naturalHeight);
      if (out) return out;
    } catch { /* fall through to the bitmap path */ }
  }
  try {
    return await readViaBitmap(src);
  } catch {
    return null;
  }
}

// What is known now, without waiting: the colour, or null while it is being
// read (or because it cannot be). Callers draw their own fallback for null and
// come back when keyColor() resolves.
export function knownKeyColor(src) {
  return src && cache.has(src) ? cache.get(src) : null;
}

// Reads the key colour, once per image. Resolves null for anything that will
// not load (and for video, which has no still to read without decoding it).
// A frame that failed to decode is given one more chance the next time it is
// asked for, since the usual cause is a shortage of room at that moment and
// not the picture; a frame that is genuinely empty settles on null.
export function keyColor(src) {
  if (!src || typeof src !== 'string') return Promise.resolve(null);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  if (inFlight.has(src)) return inFlight.get(src);
  if (!src.startsWith('data:image/') && !/^https?:/.test(src)) {
    cache.set(src, null);
    return Promise.resolve(null);
  }
  const job = lane(() => read(src)).then((out) => {
    inFlight.delete(src);
    if (out) {
      failed.delete(src);
      cache.set(src, out);
      return out;
    }
    const tries = (failed.get(src) || 0) + 1;
    failed.set(src, tries);
    if (tries > 1) cache.set(src, null); // asked twice and got nothing: let it rest
    return null;
  });
  inFlight.set(src, job);
  return job;
}

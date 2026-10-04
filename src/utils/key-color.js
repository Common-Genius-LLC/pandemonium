// A frame's key colour: the one colour that stands for it.
//
// The timeline's Storyboard row draws every boarded beat in the key colour of
// its own frame, so the row reads as the film's palette down its length: where
// it goes warm, where it goes cold, where it goes grey. A thumbnail at that
// size would be a smear (a bar is often two or three pixels wide); the colour
// of the thumbnail is the part that survives.
//
// HOW IT IS CHOSEN. The frame is drawn into a 16x16 canvas (the browser's own
// downscale does the averaging) and read back. A plain average of everything
// tends to mud, because a frame is mostly its background; so the average is
// taken twice, the second time over only the pixels whose chroma is above the
// first pass's mean. That pulls the answer towards the colour the frame is ABOUT
// while still being an average of real pixels, never a guess or a tint we
// invented. A frame with no colour in it at all (a grey or black-and-white one)
// has no chroma to favour and keeps its plain average, which is the honest
// answer for it.
//
// Fully transparent pixels are skipped: a PNG with a transparent surround would
// otherwise read as whatever the canvas was cleared to.
//
// Asynchronous, cached by the image's own data (the data URL string is the key,
// so two boards holding the same frame share one answer), and never stored in
// the project: it is derived from the image and can always be derived again.
'use strict';

const cache = new Map(); // src -> '#rrggbb' | null (null: could not be read)
const inFlight = new Map(); // src -> Promise

const SIZE = 16;

function hex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function average(data, pick) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // transparent
    if (pick && !pick(data[i], data[i + 1], data[i + 2])) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n ? { r: r / n, g: g / n, b: b / n, n } : null;
}

const chroma = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

function readKeyColor(img) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const flat = average(data);
  if (!flat) return null;
  // The mean chroma of the frame, then the average of what beats it.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    sum += chroma(data[i], data[i + 1], data[i + 2]);
    count++;
  }
  const mean = count ? sum / count : 0;
  const vivid = mean > 6 ? average(data, (r, g, b) => chroma(r, g, b) >= mean) : null;
  const out = vivid && vivid.n >= 8 ? vivid : flat;
  return '#' + hex(out.r) + hex(out.g) + hex(out.b);
}

// What is known now, without waiting: the colour, or null while it is being
// read (or because it cannot be). Callers draw their own fallback for null and
// come back when keyColor() resolves.
export function knownKeyColor(src) {
  return src && cache.has(src) ? cache.get(src) : null;
}

// Reads the key colour, once per image. Resolves null for anything that will
// not load (and for video, which has no still to read without decoding it).
export function keyColor(src) {
  if (!src || typeof src !== 'string') return Promise.resolve(null);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  if (inFlight.has(src)) return inFlight.get(src);
  const job = new Promise((resolve) => {
    if (!src.startsWith('data:image/') && !/^https?:/.test(src)) { resolve(null); return; }
    const img = new Image();
    img.decoding = 'async';
    // Only matters for an http(s) frame; a data URL is same-origin anyway, and
    // without this a remote one would taint the canvas and getImageData would
    // throw rather than return.
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      let out = null;
      try { out = readKeyColor(img); } catch { out = null; }
      resolve(out);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  }).then((out) => {
    cache.set(src, out);
    inFlight.delete(src);
    return out;
  });
  inFlight.set(src, job);
  return job;
}

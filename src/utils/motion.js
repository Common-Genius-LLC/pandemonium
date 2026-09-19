// The JS half of the app's motion system (the CSS half is the --dur-* and
// --ease-* tokens in styles/tokens.css; the numbers here match them). Used
// where CSS transitions cannot reach: an element that has just been created
// (a panel switched in, a card opening), or a move between two positions that
// only exist after a render (FLIP).
//
// Every helper does nothing for someone whose system asks for reduced motion,
// and nothing when the Web Animations API is missing: motion is a courtesy,
// never a condition for the interface to work.
'use strict';

export const DUR = { 1: 120, 2: 200, 3: 320 };
export const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_IN_OUT = 'cubic-bezier(.45,0,.2,1)';

// A damped spring, sampled: x(t) for a mass released toward 1, with a damping
// ratio of 0.8 and a natural frequency that has it settled by t = 1. That is a
// fast start, a long soft landing and a ~1.5% overshoot that settles back,
// which is how a hand moves a thing into place and why it reads as more human
// than any symmetric bezier. Pure, so the curve itself is tested.
export function springSamples(n = 32, zeta = 0.8, omega = 7.8) {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    out.push(i === n ? 1 : Math.round(x * 1000) / 1000);
  }
  return out;
}

// As an easing string: CSS linear() where the browser has it (every current
// engine), else a strong deceleration curve that keeps the fast-start shape
// without the settle.
const SPRING_FALLBACK = 'cubic-bezier(.12,.9,.24,1)';
let springEasing = null;
export function spring() {
  if (springEasing) return springEasing;
  const linear = 'linear(' + springSamples().join(', ') + ')';
  const ok = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timing-function', linear);
  springEasing = ok ? linear : SPRING_FALLBACK;
  return springEasing;
}

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(el) {
  return !!(el && typeof el.animate === 'function') && !reducedMotion();
}

// A newly shown surface arriving: a short fade with the smallest lift, so the
// eye registers "this is new" without the page appearing to move.
export function fadeIn(el, { duration = DUR[2], delay = 0, from = 0, rise = 4 } = {}) {
  if (!canAnimate(el)) return null;
  return el.animate(
    [{ opacity: from, transform: `translateY(${rise}px)` }, { opacity: 1, transform: 'none' }],
    { duration, delay, easing: EASE_OUT, fill: 'backwards' },
  );
}

// One state giving way to the next in place (a storyboard's Final frame to its
// Reference frame): a quick dip, not a full fade out and in, so the content is
// never absent long enough to feel like a reload.
export function crossfade(el, { duration = DUR[2] } = {}) {
  if (!canAnimate(el)) return null;
  return el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration, easing: EASE_OUT });
}

// The geometry to animate FROM so that an element now at `to` appears to grow
// out of `from` (both viewport rects). Pure, so it is tested on its own.
export function flipTransform(from, to) {
  if (!from || !to || !to.width || !to.height) return null;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

// FLIP: `el` has just been rendered at its final place; make it appear to
// grow out of `fromRect` (where the thing that opened it was). Scaling a box
// also scales its text, so the content fades in behind the growth rather
// than being seen stretched: `content` (optional, one element or several) is
// held back and faded in as the box finishes arriving.
export function growFrom(el, fromRect, { content = null, duration = 260, radiusFrom = null, easing = null } = {}) {
  if (!canAnimate(el) || !fromRect) return null;
  const to = el.getBoundingClientRect();
  const start = flipTransform(fromRect, to);
  if (!start) return null;
  const frames = [
    { transform: start, transformOrigin: 'top left', ...(radiusFrom != null ? { borderRadius: radiusFrom } : {}) },
    { transform: 'none', transformOrigin: 'top left' },
  ];
  const anim = el.animate(frames, { duration, easing: easing || spring() });
  // Content waits through the first third, while the box does the fast part
  // of its travel, then comes up as the box settles.
  for (const c of [].concat(content || [])) {
    if (c && typeof c.animate === 'function') {
      c.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 1 }], { duration: duration + 60, easing: 'ease-out' });
    }
  }
  return anim;
}

// The reverse: `el` (now at its final, smaller place) appears to shrink back
// into it from `fromRect` (the big surface that just closed).
export function shrinkFrom(el, fromRect, opts = {}) {
  return growFrom(el, fromRect, { duration: 220, ...opts });
}

// A rect handed from one component to another across a render: the card that
// was clicked records where it was, the view it opens reads it once. Kept
// here rather than in the store because it is not state, only a hint for one
// animation, and must never be saved or synced.
const handoff = new Map();
export function leaveRect(key, rect) { handoff.set(key, rect); }
export function takeRect(key) {
  const r = handoff.get(key) || null;
  handoff.delete(key);
  return r;
}

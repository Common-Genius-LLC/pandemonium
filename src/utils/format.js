'use strict';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

// The returned function also has `.cancel()`, so a caller that's about to
// invalidate whatever the pending call would have used (e.g. autosaving a
// project that's about to be replaced) can drop it instead of leaving a
// stale write to fire later. Without this, "debounced write A scheduled,
// then state moves on before A fires" silently resurrects state A believed
// gone -- do not remove `.cancel()` as unused-looking API surface.
export const debounce = (f, ms) => {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

export const fmtT = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Relative sync time for the cloud project list. Deliberately not a date: a
// date answers "when was this project last touched", but the question a sync
// indicator is actually asked is "did my last edit land", and only a relative
// figure answers that. Falls back to an absolute date past a week, where
// "synced 34d ago" stops being easier to read than the date itself.
export const fmtAgo = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never synced';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'synced just now';
  if (s < 3600) return 'synced ' + Math.round(s / 60) + ' min ago';
  if (s < 86400) return 'synced ' + Math.round(s / 3600) + 'h ago';
  if (s < 604800) return 'synced ' + Math.round(s / 86400) + 'd ago';
  return 'synced ' + new Date(t).toLocaleDateString();
};

export const slug = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

export const CHIPCOLORS = ['#c8ffc9', '#ffc8fa', '#ffc8c9', '#c8d9ff'];

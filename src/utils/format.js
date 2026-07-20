'use strict';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export const debounce = (f, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
};

export const fmtT = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const slug = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

export const CHIPCOLORS = ['#c8ffc9', '#ffc8fa', '#ffc8c9', '#c8d9ff'];

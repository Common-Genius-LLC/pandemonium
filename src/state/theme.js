// Light/dark theme selection. Framework-agnostic and EventTarget-based, the
// same shape as data/session.js, so any component can subscribe without pulling
// in the store, and so nothing here needs a DOM beyond the document element it
// stamps.
//
// The whole mechanism is one attribute. styles/tokens.css declares the dark
// palette under :root[data-theme="dark"], and because design tokens are
// inherited CSS custom properties, writing that attribute re-themes every
// shadow root in the app at once. No component subscribes to this for color.
//
// Theme is a per-user preference and lives in localStorage. Panel layout is the
// opposite case and lives in the project (see data/layout-tree.js): one is
// about the person at the keyboard, the other about how a particular project is
// being worked on.
'use strict';

const KEY = 'pnd_theme';
const MEDIA = '(prefers-color-scheme: dark)';

const PREFERENCES = ['light', 'dark', 'system'];

class Theme extends EventTarget {
  #pref = 'system';
  #media = null;

  // Called once from main.js, before the app mounts, so the first paint is
  // already in the right theme and there is no white flash on a dark desktop.
  init() {
    try {
      const stored = localStorage.getItem(KEY);
      if (PREFERENCES.includes(stored)) this.#pref = stored;
    } catch { /* private mode: fall back to following the system */ }
    this.#media = matchMedia(MEDIA);
    // Only meaningful while following the system, but subscribed
    // unconditionally: the listener is free and this way switching back to
    // 'system' does not have to re-attach it.
    this.#media.addEventListener('change', () => { if (this.#pref === 'system') this.#apply(); });
    this.#apply();
  }

  get preference() { return this.#pref; }

  get resolved() {
    if (this.#pref !== 'system') return this.#pref;
    return this.#media && this.#media.matches ? 'dark' : 'light';
  }

  set(pref) {
    if (!PREFERENCES.includes(pref)) return;
    this.#pref = pref;
    try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
    this.#apply();
  }

  // What the toggle button does: flip to the opposite of what is on screen.
  // This deliberately leaves 'system' behind rather than cycling through it,
  // because someone reaching for the toggle at 2am wants the other theme now,
  // not a third state that might not change anything.
  toggle() { this.set(this.resolved === 'dark' ? 'light' : 'dark'); }

  #apply() {
    document.documentElement.setAttribute('data-theme', this.resolved);
    this.dispatchEvent(new CustomEvent('change'));
  }
}

export const theme = new Theme();

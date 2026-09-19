// How the script is laid out on screen: which paper, and how large the text
// is drawn. A per-person preference, like the theme (state/theme.js) and
// unlike the panel layout: it is about the eyes at this screen, not about the
// project, so it lives in localStorage and never syncs.
//
// Text size scales the whole page, never the grid: a page holds the same
// characters and lines at every size (see fountain/paginate.js), so page
// breaks, page count and the minutes-per-page estimate do not move when a
// writer makes the text bigger.
'use strict';

import { PAPERS } from '../fountain/paginate.js';

const KEY = 'pnd_script_layout';
export const TEXT_SIZES = [10, 11, 12, 14, 16]; // points; 12 is the standard
const DEFAULTS = { paper: 'a4', textPt: 12 };

class ScriptPrefs extends EventTarget {
  #v = { ...DEFAULTS };

  constructor() {
    super();
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (stored && PAPERS[stored.paper]) this.#v.paper = stored.paper;
      if (stored && TEXT_SIZES.includes(stored.textPt)) this.#v.textPt = stored.textPt;
    } catch { /* private mode or a bad value: defaults */ }
  }

  get paper() { return this.#v.paper; }
  get textPt() { return this.#v.textPt; }

  set(patch) {
    const next = { ...this.#v };
    if (patch.paper && PAPERS[patch.paper]) next.paper = patch.paper;
    if (TEXT_SIZES.includes(patch.textPt)) next.textPt = patch.textPt;
    if (next.paper === this.#v.paper && next.textPt === this.#v.textPt) return;
    this.#v = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    this.dispatchEvent(new CustomEvent('change'));
  }
}

export const scriptPrefs = new ScriptPrefs();

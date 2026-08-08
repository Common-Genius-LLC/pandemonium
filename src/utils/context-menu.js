// The one place "global items belong on every context menu" is expressed.
// Every right-click handler in the app (the per-panel menus in
// panel-layout.js, and the chrome fallback in pandemonium-app.js) builds its
// own specific items, if any, and passes them through here before dispatching
// `pandemonium-open-menu`, so there is exactly one copy of what "global" means
// rather than one per call site.
'use strict';

import { theme } from '../state/theme.js';
import { BETA } from '../config/beta.js';
import { bugReporter } from './bug-report.js';
import { dispatch } from './events.js';

export function withGlobalItems(el, items = []) {
  const global = [
    { label: 'Toggle theme', fn: () => theme.toggle() },
  ];
  // Bug reporting is beta-only (see config/beta.js); this replaces the old
  // floating badge as the one way to reach it, so it must survive on every
  // menu regardless of which panel (or no panel) was right-clicked.
  if (BETA) {
    const n = bugReporter.errorCount;
    global.push({
      label: n ? `Report a problem (${n} logged)` : 'Report a problem',
      fn: () => dispatch(el, 'pandemonium-open-bug-report', {}),
    });
  }
  return items.length ? [...items, { divider: true }, ...global] : global;
}

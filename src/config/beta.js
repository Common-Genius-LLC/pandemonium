// The beta switch. This is the ONE place beta mode is decided: the corner
// badge, the bug reporter, the global error capture, and the Ctrl-Alt-B
// shortcut all read `BETA` from here and mount nothing when it is false.
//
// To leave beta: set VITE_BETA_MODE=false in the environment (.env locally,
// the Pages build variables in production) and rebuild. Nothing else changes.
// Vite substitutes import.meta.env at build time, so BETA becomes a literal
// `false` and the bundler drops the guarded branches instead of shipping dead
// beta code to users.
//
// Default is ON. Beta is the current state of this app, so a fresh clone and a
// forgotten build variable both land on the safe side, which is showing the
// badge rather than silently hiding the only way a tester can report a bug.
'use strict';

export const BETA = import.meta.env.VITE_BETA_MODE !== 'false';

// Shown on the badge and attached to every report, so a report can be tied to
// the build it came from. Set VITE_APP_VERSION in CI (a git sha works well).
export const BUILD_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

// Where a submitted report goes. Any endpoint that accepts a JSON POST works:
// your own /v1/feedback route, a Formspree form, a Slack or Discord webhook,
// a Google Apps Script. Left empty the reporter still works and falls back to
// putting the report on the clipboard, which is what a fresh clone gets.
export const FEEDBACK_ENDPOINT = import.meta.env.VITE_FEEDBACK_ENDPOINT || '';

// Only used by the clipboard fallback, to tell the tester where to send it.
export const FEEDBACK_CONTACT = import.meta.env.VITE_FEEDBACK_CONTACT || '';

// Which screen the app shows. An account is required: with no project open,
// someone who is not signed in sees the landing page (or the sign-in page once
// they have chosen to get started), never the home screen and never their old
// browser-local work. Pure, so the rule is testable and lives in one place
// rather than being spread across the shell's render and boot code.
//
//   boot     the session is still being restored: show nothing that could be
//            wrong (no landing page flashing at someone who is signed in)
//   app      a project is open, and the person may be looking at it
//   start    signed in, no project open: the home screen
//   landing  not signed in
//   login    not signed in, on the sign-in page
//
// A project open in a shared read-only view is the one thing a signed-out
// visitor may see: that link is public by design, and reading it needs no
// account. It never autosaves (see the shell), so it cannot leave anything
// behind.
'use strict';

export const LOGIN_PATH = '/login';

export function isLoginPath(path) {
  return typeof path === 'string' && /^\/login\/?$/.test(path);
}

export function screenFor({ booted, hasProject, sharedView, authed, path }) {
  if (!booted) return 'boot';
  if (hasProject && (authed || sharedView)) return 'app';
  if (authed) return 'start';
  return isLoginPath(path) ? 'login' : 'landing';
}

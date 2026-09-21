// The account gate: which screen shows for each combination of session,
// project and address.
'use strict';

import { describe, it, expect } from 'vitest';
import { screenFor, isLoginPath } from './gate.js';

const base = { booted: true, hasProject: false, sharedView: false, authed: false, path: '/' };

describe('screenFor', () => {
  it('shows nothing decisive until the session has been restored', () => {
    expect(screenFor({ ...base, booted: false })).toBe('boot');
    expect(screenFor({ ...base, booted: false, authed: true, hasProject: true })).toBe('boot');
  });

  it('sends someone who is not signed in to the landing page', () => {
    expect(screenFor(base)).toBe('landing');
    expect(screenFor({ ...base, path: '/anything-else' })).toBe('landing');
  });

  it('shows the sign-in page at /login, with or without a trailing slash', () => {
    expect(screenFor({ ...base, path: '/login' })).toBe('login');
    expect(screenFor({ ...base, path: '/login/' })).toBe('login');
    expect(screenFor({ ...base, path: '/login/extra' })).toBe('landing');
  });

  it('shows the home screen to someone signed in with no project open, wherever the address points', () => {
    expect(screenFor({ ...base, authed: true })).toBe('start');
    expect(screenFor({ ...base, authed: true, path: '/login' })).toBe('start');
  });

  it('opens the app for a signed-in person with a project', () => {
    expect(screenFor({ ...base, authed: true, hasProject: true })).toBe('app');
  });

  it('never shows an open project to someone who is neither signed in nor viewing a share', () => {
    // The state a sign-out passes through, and a browser-local project left
    // in memory: both must land on the landing page, not on the project.
    expect(screenFor({ ...base, hasProject: true })).toBe('landing');
  });

  it('lets a shared read-only link open without an account', () => {
    expect(screenFor({ ...base, hasProject: true, sharedView: true })).toBe('app');
  });

  it('sends a share link that did not load to the landing page', () => {
    expect(screenFor({ ...base, sharedView: false })).toBe('landing');
  });
});

describe('isLoginPath', () => {
  it('accepts only /login', () => {
    expect(isLoginPath('/login')).toBe(true);
    expect(isLoginPath('/')).toBe(false);
    expect(isLoginPath('/logins')).toBe(false);
    expect(isLoginPath(undefined)).toBe(false);
  });
});

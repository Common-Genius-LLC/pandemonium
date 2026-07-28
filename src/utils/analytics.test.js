// Locks the analytics wrapper's contract: never throws, no-ops without a
// measurement id, dedupes consecutive views, and reports virtual paths in a
// form GA4 actually processes (page_location, since GA4 derives Page path
// from it and ignores the UA-era page_path field).
//
// No jsdom: the module only touches window.dataLayer/gtag/location, so a
// plain object stands in for window. Fresh module per test via resetModules,
// because the wrapper holds state (active id, last-view key) on purpose.
'use strict';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGIN = 'https://app.test';

function makeWindow() {
  return { location: { origin: ORIGIN, href: ORIGIN + '/' } };
}

// dataLayer entries are `arguments` objects; normalize for assertions.
function calls(win) {
  return (win.dataLayer || []).map((a) => Array.from(a));
}

let win;
let analytics;

beforeEach(async () => {
  vi.resetModules();
  win = makeWindow();
  globalThis.window = win;
  analytics = await import('./analytics.js');
});

afterEach(() => {
  delete globalThis.window;
});

describe('initAnalytics', () => {
  it('refuses an empty measurement id', () => {
    expect(analytics.initAnalytics('')).toBe(false);
    expect(win.dataLayer).toBeUndefined();
  });

  it('configures once, with the automatic page_view suppressed', () => {
    expect(analytics.initAnalytics('G-TEST1')).toBe(true);
    const c = calls(win);
    expect(c[0][0]).toBe('js');
    expect(c[1][0]).toBe('config');
    expect(c[1][1]).toBe('G-TEST1');
    expect(c[1][2]).toMatchObject({ send_page_view: false });
    // A second init with the same id is a no-op, not a second config
    // (a second config would re-fire the automatic page_view).
    expect(analytics.initAnalytics('G-TEST1')).toBe(true);
    expect(calls(win).filter((c2) => c2[0] === 'config')).toHaveLength(1);
  });

  it('reuses an existing gtag stub instead of replacing it', () => {
    // index.html defines gtag before the app boots; clobbering it would
    // orphan the loader's queue.
    const pushed = [];
    win.dataLayer = [];
    win.gtag = function () { pushed.push(Array.from(arguments)); };
    analytics.initAnalytics('G-TEST1');
    expect(pushed.some((c) => c[0] === 'config')).toBe(true);
  });
});

describe('events before init', () => {
  it('report failure instead of throwing or queueing', () => {
    expect(analytics.trackProjectSave({ target: 'file' })).toBe(false);
    expect(analytics.trackPdfExport({ export_type: 'script' })).toBe(false);
    expect(win.dataLayer).toBeUndefined();
  });

  it('never throw without a window at all', () => {
    delete globalThis.window;
    expect(analytics.initAnalytics('G-TEST1')).toBe(false);
    expect(analytics.trackScriptParse({ source: 'import' })).toBe(false);
  });
});

describe('event params', () => {
  it('strips null and undefined values', () => {
    analytics.initAnalytics('G-TEST1');
    analytics.trackProjectSave({ target: 'file', script_count: 0, junk: null, gone: undefined });
    const ev = calls(win).find((c) => c[0] === 'event');
    expect(ev[1]).toBe('project_save');
    expect(ev[2]).toEqual({ target: 'file', script_count: 0 });
  });
});

describe('trackVirtualView', () => {
  it('builds page_location from the origin plus the virtual path', () => {
    analytics.initAnalytics('G-TEST1');
    expect(analytics.trackVirtualView('Storyboard', { page_path: '/project/boards' })).toBe(true);
    const ev = calls(win).find((c) => c[0] === 'event' && c[1] === 'page_view');
    expect(ev[2].page_path).toBe('/project/boards');
    expect(ev[2].page_location).toBe(ORIGIN + '/project/boards');
    expect(ev[2].page_title).toBe('Storyboard');
  });

  it('slugifies a path from the view name when none is given', () => {
    analytics.initAnalytics('G-TEST1');
    analytics.trackVirtualView('Research Edit');
    const ev = calls(win).find((c) => c[0] === 'event' && c[1] === 'page_view');
    expect(ev[2].page_path).toBe('/research-edit');
  });

  it('suppresses consecutive duplicates but not alternation', () => {
    analytics.initAnalytics('G-TEST1');
    expect(analytics.trackVirtualView('A', { page_path: '/a' })).toBe(true);
    expect(analytics.trackVirtualView('A', { page_path: '/a' })).toBe(false);
    expect(analytics.trackVirtualView('B', { page_path: '/b' })).toBe(true);
    expect(analytics.trackVirtualView('A', { page_path: '/a' })).toBe(true);
    const views = calls(win).filter((c) => c[0] === 'event' && c[1] === 'page_view');
    expect(views).toHaveLength(3);
  });

  it('does not let a pre-init view poison the dedupe key', () => {
    // Raised before init: not sent, and must NOT be remembered, or the same
    // view raised after init would be swallowed as a duplicate forever.
    expect(analytics.trackVirtualView('Start screen', { page_path: '/start' })).toBe(false);
    analytics.initAnalytics('G-TEST1');
    expect(analytics.trackVirtualView('Start screen', { page_path: '/start' })).toBe(true);
  });
});

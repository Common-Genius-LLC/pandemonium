// The GA4 seam. Every analytics call in the app goes through here, so that
// swapping GA4 for something else (or switching it off) is one file, and so
// that no feature module has to know gtag exists.
//
// Two rules hold for everything below:
//
//   - Never send user content. No project names, script names, research doc
//     titles, or passage text. A screenplay in pre-production is confidential
//     material and it does not go to Google. Counts, ids, and enum-ish
//     descriptors only.
//   - Never throw and never block. Every function returns a boolean and
//     no-ops when GA4 is unconfigured (no measurement id in the env), which
//     is the normal state for a fresh clone and for the test runner.
'use strict';

import { BETA } from '../config/beta.js';

const DEFAULT_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || '';

let activeMeasurementId = '';
let lastVirtualViewKey = '';

function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

function ensureGtag(win) {
  if (!win) return false;
  win.dataLayer = win.dataLayer || [];
  if (typeof win.gtag !== 'function') {
    win.gtag = function gtag() {
      win.dataLayer.push(arguments);
    };
  }
  return true;
}

function cleanParams(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    out[key] = value;
  }
  return out;
}

function slugify(text) {
  const value = String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value || 'view';
}

function sendEvent(name, params = {}) {
  const win = getWindow();
  if (!win || !activeMeasurementId) return false;
  if (!ensureGtag(win)) return false;
  win.gtag('event', name, cleanParams(params));
  return true;
}

export function initAnalytics(measurementId = DEFAULT_MEASUREMENT_ID) {
  const win = getWindow();
  if (!win || !measurementId) return false;
  if (activeMeasurementId === measurementId) return true;
  if (!ensureGtag(win)) return false;
  activeMeasurementId = measurementId;
  win.gtag('js', new Date());
  // send_page_view:false because every view in this app is a virtual one
  // raised from the store. Leaving it on gives an extra automatic page_view
  // at the real URL on load, which double-counts against the first real view.
  //
  // debug_mode rides the beta flag: on for the beta so reports land in
  // DebugView, off automatically the moment beta is switched off. That is
  // also why this is the only config call. A second one in index.html would
  // re-fire the page_view this one exists to suppress.
  win.gtag('config', measurementId, { send_page_view: false, debug_mode: BETA });
  return true;
}

// The app is a single URL, so panel and reader changes are reported as
// virtual page views. This is the one place consecutive-duplicate views are
// suppressed; callers do not need their own guard.
export function trackVirtualView(viewName, params = {}) {
  const win = getWindow();
  const pageTitle = params.page_title || viewName;
  const pagePath = params.page_path || '/' + slugify(viewName);
  const key = `${pageTitle}|${pagePath}`;
  if (key === lastVirtualViewKey) return false;
  const sent = sendEvent('page_view', {
    ...cleanParams(params),
    page_title: pageTitle,
    page_path: pagePath,
    page_location: params.page_location || (win ? win.location.href : undefined),
  });
  // Only remember the view once it actually went out, so a view raised before
  // initAnalytics() ran is not swallowed permanently.
  if (sent) lastVirtualViewKey = key;
  return sent;
}

export function trackProjectSave(params = {}) {
  return sendEvent('project_save', cleanParams(params));
}

export function trackScriptParse(params = {}) {
  return sendEvent('script_parse', cleanParams(params));
}

export function trackStoryboardLinkAdd(params = {}) {
  return sendEvent('storyboard_link_add', cleanParams(params));
}

export function trackResearchLinkAdd(params = {}) {
  return sendEvent('research_link_add', cleanParams(params));
}

export function trackPdfExport(params = {}) {
  return sendEvent('pdf_export', cleanParams(params));
}

// Beta only. The report body never comes through here: this records that a
// report happened and how it was delivered, so a delivery channel silently
// failing shows up as a gap rather than as silence.
export function trackBugReport(params = {}) {
  return sendEvent('bug_report', cleanParams(params));
}
// Beta bug reporting: what a report contains, how it is collected, and where
// it goes. The UI for it lives in components/beta/; this module has no DOM of
// its own so the delivery channel can change without touching a component.
//
// The whole thing is inert unless BETA is on (see config/beta.js). install()
// is the only entry point that attaches anything global, and app-root calls it
// behind that flag.
//
// On privacy: a report carries counts and error stacks by default, never the
// screenplay. Attaching the project is a separate, explicit, off-by-default
// choice the tester makes in the dialog, and even then embedded board images
// are stripped out (they are multi-megabyte data URLs and never the bug).
'use strict';

import { BETA, BUILD_VERSION, FEEDBACK_ENDPOINT } from '../config/beta.js';
import { session } from '../data/session.js';

const MAX_ERRORS = 12;
const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) + ' [truncated]' : s;
}

// Errors are collected continuously from the moment install() runs, so that a
// tester who hits a bug and opens the reporter a minute later still has the
// stack attached. Without this they can only describe what they saw, which is
// the difference between a reproducible report and "it broke sometimes".
class BugReporter extends EventTarget {
  #errors = [];
  #installed = false;

  get errors() { return this.#errors.slice(); }
  get errorCount() { return this.#errors.length; }

  clearErrors() {
    this.#errors = [];
    this.dispatchEvent(new CustomEvent('change'));
  }

  install() {
    if (this.#installed || !BETA || typeof window === 'undefined') return;
    this.#installed = true;

    window.addEventListener('error', (e) => {
      // Failed <img>/<script> loads arrive here too, with no .error object.
      if (!e.error && !e.message) return;
      this.#record({
        source: 'error',
        message: clip(e.message || String(e.error), MAX_MESSAGE),
        stack: clip(e.error && e.error.stack, MAX_STACK),
        at: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '',
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      this.#record({
        source: 'unhandledrejection',
        message: clip(r && r.message ? r.message : String(r), MAX_MESSAGE),
        stack: clip(r && r.stack, MAX_STACK),
        at: '',
      });
    });

    // The app reports its own recoverable failures through console.warn/error
    // (autosave, remote load, print). Those never reach window.onerror, and
    // they are exactly the ones a tester cannot see. Always calls through, so
    // the console behaves normally.
    for (const level of ['error', 'warn']) {
      const original = console[level];
      if (typeof original !== 'function') continue;
      console[level] = (...args) => {
        try {
          this.#record({
            source: 'console.' + level,
            message: clip(args.map(describe).join(' '), MAX_MESSAGE),
            stack: '',
            at: '',
          });
        } catch { /* capture must never break logging */ }
        original.apply(console, args);
      };
    }
  }

  #record(entry) {
    this.#errors.push({ ...entry, when: new Date().toISOString() });
    if (this.#errors.length > MAX_ERRORS) this.#errors.shift();
    this.dispatchEvent(new CustomEvent('change'));
  }
}

function describe(v) {
  if (v instanceof Error) return v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const bugReporter = new BugReporter();

// Board images are data URLs, often several megabytes each, and they are never
// what a bug report needs. Everything else about the project is kept intact so
// the report can be loaded and the bug reproduced.
function redactProject(project) {
  if (!project) return null;
  let imagesRemoved = 0;
  const boards = (project.boards || []).map((b) => {
    if (!b.img) return b;
    imagesRemoved += 1;
    return { ...b, img: `[image removed: ${b.img.length} chars]` };
  });
  return { ...project, boards, imagesRemoved };
}

// `store` is the live PandemoniumStore; `view` is the current virtual path.
export function buildReport({ kind, message, steps, email, includeProject, store, view }) {
  const project = store && store.project;
  return {
    kind: kind || 'bug',
    message: String(message || ''),
    steps: String(steps || ''),
    email: String(email || ''),
    version: BUILD_VERSION,
    when: new Date().toISOString(),
    view: view || '',
    app: {
      hasProject: !!project,
      scripts: project ? project.scripts.length : 0,
      boards: project ? project.boards.length : 0,
      links: project ? project.links.length : 0,
      research: project ? project.research.length : 0,
      comments: project ? (project.comments || []).length : 0,
      dirty: !!(store && store.ui && store.ui.dirty),
      sessionMode: session.getMode(),
    },
    env: {
      ua: navigator.userAgent,
      language: navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      theme: document.documentElement.getAttribute('data-theme') || 'light',
      online: navigator.onLine,
    },
    errors: bugReporter.errors,
    project: includeProject ? redactProject(project) : null,
  };
}

// Returns {ok, channel} rather than throwing: the dialog needs to tell the
// tester what happened either way, and a report that could not be posted is
// still worth putting somewhere they can paste it from.
export async function submitReport(report) {
  const body = JSON.stringify(report, null, 2);

  if (FEEDBACK_ENDPOINT) {
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      });
      if (res.ok) return { ok: true, channel: 'endpoint' };
    } catch { /* offline or blocked: fall through to the clipboard */ }
  }

  try {
    await navigator.clipboard.writeText(body);
    return { ok: true, channel: 'clipboard' };
  } catch { /* no clipboard permission, or an insecure context */ }

  try {
    downloadReport(body, report.when);
    return { ok: true, channel: 'download' };
  } catch {
    return { ok: false, channel: 'none' };
  }
}

function downloadReport(body, when) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pandemonium-report-${String(when).replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

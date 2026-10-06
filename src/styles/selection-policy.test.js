// Locks the selection policy.
//
// global.css makes the whole interface unselectable (user-select: none on
// <pandemonium-app>), and that value reaches every shadow root. What the writer
// types into has to switch it back on, in the shadow root where it lives: an
// ordinary rule does not cross a shadow boundary, so selectableStyles
// (styles/shared.js) has to be carried by every component that renders an
// editable element. Nothing else notices if one is forgotten, and the failure
// is the worst kind: a field that works in one browser and not in another.
//
// This reads the component sources, so a new field fails the build with the file
// named instead of failing on someone's Safari.
'use strict';

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectableStyles } from './shared.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourcesIn(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourcesIn(p));
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

// Comments name these things all the time ("a contenteditable in the path");
// only code and templates count.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// An element the writer types into: a text-like <input>, a <textarea>, or an
// element given a contenteditable that is not "false". A file input, a checkbox
// and the like hold no text.
const NON_TEXT_INPUT = /type=["'](?:file|checkbox|radio|range|button|submit|color|hidden)["']/;
function rendersEditable(code) {
  if (/<textarea\b/.test(code) || /\bcontenteditable\s*=\s*(?!["']false["'])/.test(code)) return true;
  for (const m of code.matchAll(/<input\b[^>]*/g)) if (!NON_TEXT_INPUT.test(m[0])) return true;
  return false;
}

// Carries the rule itself, or one of the shared fragments that includes it.
function carriesPolicy(code) {
  return /user-select\s*:\s*text/.test(code)
    || /\buserSelect\s*:\s*['"]text['"]/.test(code)
    || /\b(?:formStyles|panelStyles|selectableStyles)\b/.test(code);
}

// A field that renders inside <pd-dialog>'s own shadow root, which carries
// formStyles, even though the template is written elsewhere.
const RENDERED_IN_DIALOG = new Set([
  'app-root/draft-chip.js',
]);

describe('selection policy', () => {
  it('makes the interface unselectable at the app element, with the prefix Safari needs', () => {
    const css = readFileSync(join(SRC, 'styles/global.css'), 'utf8');
    expect(css).toMatch(/pandemonium-app\s*\{[^}]*-webkit-user-select\s*:\s*none[^}]*\buser-select\s*:\s*none/);
  });

  it('keeps the public pages, which are documents, selectable', () => {
    for (const f of ['components/landing/landing.js', 'components/auth/login.js']) {
      expect(readFileSync(join(SRC, f), 'utf8'), f).toMatch(/user-select\s*:\s*text/);
    }
  });

  it('switches text back on for fields, textareas and contenteditable, and only for those', () => {
    const css = selectableStyles.cssText;
    expect(css).toContain('input');
    expect(css).toContain('textarea');
    expect(css).toContain('[contenteditable]:not([contenteditable="false"])');
    expect(css).toMatch(/-webkit-user-select\s*:\s*text/);
    expect(css).toMatch(/[^-]user-select\s*:\s*text/);
  });

  it('is carried by every component that renders something the writer types into', () => {
    const missing = [];
    let checked = 0;
    for (const file of sourcesIn(SRC)) {
      const rel = relative(SRC, file);
      if (rel === 'styles/shared.js') continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!rendersEditable(code)) continue;
      checked++;
      if (!carriesPolicy(code) && !RENDERED_IN_DIALOG.has(rel)) missing.push(rel);
    }
    // A guard that finds nothing to guard has stopped working, not succeeded.
    expect(checked).toBeGreaterThan(10);
    expect(missing, 'these render an editable element but never switch user-select back on; spread selectableStyles (styles/shared.js) into their static styles').toEqual([]);
  });
});

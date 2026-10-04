// Markdown, coloured where it stands.
//
// A Markdown draft is drawn with its markers visible and its lines styled by
// WEIGHT AND COLOUR ONLY. That is not a shortcut, it is the constraint the page
// imposes: the script page is a real character grid (fountain/paginate.js lays
// the document out in rows and columns of a monospace cell, and cm-pages.js
// draws sheets against that grid), so a heading set two sizes larger would be
// taller and wider than the row it was laid out on, and the text would walk off
// its sheet. Bold, italic and a colour change cost no cell.
//
// For the same reason the markers are not hidden the way Fountain's are: a
// Fountain marker is one character at the head of a line, and the page counts
// what is drawn (displayLines). Hiding `#` or `- ` would mean teaching the
// page layout about a second syntax to get the row counts right, for a format
// where the marker is part of how people read their own notes anyway.
//
// Hand-rolled, like the Fountain parser, and for the same reason: a Markdown
// grammar package (and its lezer dependencies) would be a large addition to
// colour six line shapes and two inline ones.
'use strict';

import { ViewPlugin, Decoration } from '@codemirror/view';

// Line shapes, in the order they are tested. Anything that matches none of them
// is a paragraph and takes no class.
const LINE_RULES = [
  // A fenced code block's fence, and (below) its contents, which are held by
  // the plugin's own state rather than by a regex.
  [/^\s*(```|~~~)/, 'cmd-fence'],
  [/^\s*(#{1,6})\s+\S/, 'cmd-head'],
  [/^\s*>\s?/, 'cmd-quote'],
  [/^\s*([-*+]|\d{1,9}[.)])\s+\S/, 'cmd-list'],
  [/^\s*(-{3,}|\*{3,}|_{3,})\s*$/, 'cmd-rule'],
  [/^\s{4,}\S/, 'cmd-code'],
];

// The marker at the head of a line, which is dimmed rather than hidden: the
// words after it are what the writer reads, and the marker is what tells them
// which kind of line it is.
const MARKER = [
  [/^(\s*#{1,6}\s+)/, 'cmd-mark'],
  [/^(\s*>\s?)/, 'cmd-mark'],
  [/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)/, 'cmd-mark'],
];

// `**bold**`, `*italic*`, `` `code` ``. Deliberately simple: one pass per line,
// no nesting, no reference links. Anything it does not recognise is left as
// plain text, which is the right failure for a highlighter.
const INLINE = [
  [/\*\*([^*\n]+)\*\*/g, 'cmd-b'],
  [/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, 'cmd-i'],
  [/(?<!`)`([^`\n]+)`(?!`)/g, 'cmd-code-inline'],
  [/\[([^\]\n]+)\]\(([^)\s]+)\)/g, 'cmd-link'],
];

function lineClass(text) {
  for (const [re, cls] of LINE_RULES) if (re.test(text)) return cls;
  return null;
}

function build(view) {
  const decos = [];
  const doc = view.state.doc;
  let inFence = false;
  // Only the visible ranges: a long document must not be re-decorated end to
  // end on every keystroke (the same reason the minimap draws per page).
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    while (line.from <= to) {
      const text = line.text;
      const cls = lineClass(text);
      if (cls === 'cmd-fence') {
        inFence = !inFence;
        decos.push(Decoration.line({ class: 'cmd-mark' }).range(line.from));
      } else if (inFence) {
        decos.push(Decoration.line({ class: 'cmd-code' }).range(line.from));
      } else if (cls) {
        decos.push(Decoration.line({ class: cls }).range(line.from));
        for (const [re, mk] of MARKER) {
          const m = re.exec(text);
          if (m && m[1].length) {
            decos.push(Decoration.mark({ class: mk }).range(line.from, line.from + m[1].length));
            break;
          }
        }
      }
      if (!inFence && cls !== 'cmd-fence' && cls !== 'cmd-rule') {
        for (const [re, icls] of INLINE) {
          re.lastIndex = 0;
          let m = re.exec(text);
          while (m) {
            const s = line.from + m.index;
            const e = s + m[0].length;
            if (e > s) decos.push(Decoration.mark({ class: icls }).range(s, e));
            m = re.exec(text);
          }
        }
      }
      if (line.to >= doc.length) break;
      line = doc.lineAt(line.to + 1);
    }
  }
  // Sorted, because the inline passes run per rule rather than per position.
  return Decoration.set(decos, true);
}

export function markdownDecorations() {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
    }
  }, { decorations: (v) => v.decorations });
}

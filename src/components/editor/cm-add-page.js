// "Add page": one pill per page, at the foot of the sheet on the right, which
// starts a new page there.
//
// What it writes is a Fountain forced page break, `===` (parse.js), so the
// break is in the document and travels with it: into the file, into a PDF
// export, and into anyone else's copy. Nothing about the page layout is stored
// anywhere else, and nothing here knows how to paginate; it only writes the
// one line that makes the layout break where the writer asked.
//
// After the break goes in, the caret lands on the blank line that starts the
// new page, because the only reason to ask for a page is to write on it.
//
// The pill sits on the desk BELOW its sheet, right-aligned to the page, which
// is why the gap between two sheets is 40px rather than the 12px of a stack of
// paper (DEFAULT_METRICS in cm-pages.js): a control that belongs to the page
// but is not part of it does not go on the paper. It is half-faded until the
// pointer is over the editor, so a twelve-page script does not read as twelve
// buttons, and it is the row rail's "link to" pill in every other respect
// (cm-theme.js), being the same kind of control on the same desk.
'use strict';

import { ViewPlugin } from '@codemirror/view';
import { sheetRects, setPageMetrics } from './cm-pages.js';

// How far below the sheet's bottom edge the pill sits: enough to clear the
// paper's edge and its shadow, and to stay clear of the next sheet's top (the
// desk between two pages is 40px and the pill is 24px tall).
const BELOW = 9;

function insertAt(view, page) {
  const { layout } = sheetRects(view);
  const doc = view.state.doc;
  const next = layout.pages[page + 1];
  if (next) {
    // Before the first line of the next page: that page's content is pushed
    // down to start after the break, and the blank line between them is the
    // new page's first line.
    const pos = doc.line(Math.min(next.start + 1, doc.lines)).from;
    return { from: pos, insert: '===\n\n', caret: pos + 4 };
  }
  // The last page: the break goes at the end of the document, with a blank
  // line before it unless the writer has already left one.
  const pos = doc.length;
  const lead = doc.line(doc.lines).text.trim() ? '\n\n' : '';
  return { from: pos, insert: lead + '===\n\n', caret: pos + lead.length + 4 };
}

function addPage(view, page) {
  const { from, insert, caret } = insertAt(view, page);
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: caret },
    scrollIntoView: true,
  });
  view.focus();
}

class AddPageButtons {
  constructor(view) {
    this.view = view;
    this.dom = document.createElement('div');
    this.dom.className = 'cm-addpage-layer';
    // The buttons are the only thing in here that takes a press: the layer
    // itself must not swallow a click meant for the page under it.
    this.dom.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.cm-addpage');
      if (!btn) return;
      // mousedown, not click: CodeMirror would otherwise move the caret to
      // wherever the press landed before the button ever ran.
      e.preventDefault();
      e.stopPropagation();
      addPage(this.view, Number(btn.dataset.page));
    });
    view.scrollDOM.appendChild(this.dom);
    this.draw();
  }

  update(u) {
    if (u.docChanged || u.geometryChanged || u.viewportChanged
      || u.transactions.some((tr) => tr.effects.some((e) => e.is(setPageMetrics)))) this.draw();
  }

  draw() {
    const { rects, geom } = sheetRects(this.view);
    // The pill's right edge lines up with the text column's right edge, so it
    // sits where the last word of a line does rather than floating in the
    // margin. The right margin is whatever the sheet has left over once the
    // left margin and the column are taken off (the same arithmetic the
    // content box uses, see cm-theme.js).
    const ch = this.view.defaultCharacterWidth || 0;
    const right = Math.max(8, geom.pageW - geom.left - geom.cols * ch);
    while (this.dom.childElementCount > rects.length) this.dom.lastElementChild.remove();
    while (this.dom.childElementCount < rects.length) {
      const b = document.createElement('button');
      b.className = 'cm-addpage';
      b.type = 'button';
      b.textContent = 'Add page';
      b.title = 'Start a new page here (writes a Fountain page break)';
      this.dom.appendChild(b);
    }
    rects.forEach((r, i) => {
      const b = this.dom.children[i];
      b.dataset.page = String(i);
      b.style.left = (r.left + r.width - right) + 'px';
      b.style.top = (r.top + r.height + BELOW) + 'px';
      b.style.transform = 'translateX(-100%)';
    });
  }

  destroy() {
    this.dom.remove();
  }
}

export function addPageButtons() {
  return ViewPlugin.fromClass(AddPageButtons);
}

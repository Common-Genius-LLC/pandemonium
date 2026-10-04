// "Add page": one control on the desk under the last sheet, left-aligned with
// it, that IS the page it makes.
//
// At rest it is a small white pill wearing the page's own shadow. Hover it and
// it becomes a page: the label fades out and the box grows down to a page's
// proportions at the pill's width, so what is about to be added is shown rather
// than described. Click it and that small page grows to full size in the place
// the next sheet will occupy, and the real sheet takes over from it: the object
// the writer pressed is the object they get.
//
// What it writes is a page break, `===` on its own line with a blank line
// before it, so the break lives in the document and travels with it: into the
// file, into a PDF export, and into anyone else's copy. Nothing about the page
// layout is stored anywhere else, and nothing here knows how to paginate; it
// only writes the one line that makes the layout break where the writer asked.
//
// The same line in every format. Fountain has always read `===` as a forced
// break (parse.js); a plain-text or Markdown draft reads it as one too, and
// only with a blank line in front of it, which is both what keeps it clear of
// Markdown's setext heading and exactly what this writes (see
// fountain/plain.js). Before that, Add page wrote a line of equals signs into
// prose that nothing read, so it put junk in the document and broke no page. The caret lands on
// the blank line that starts the new page, because the only reason to ask for a
// page is to write on it.
//
// There is one of these, under the last page, not one per page. A page in the
// middle of a script is broken by writing; a page at the end is the one a
// writer asks for.
'use strict';

import { ViewPlugin } from '@codemirror/view';
import { sheetRects, setPageMetrics } from './cm-pages.js';
import { DUR, EASE_OUT, reducedMotion } from '../../utils/motion.js';

// The pill's width, which is also the mini page's. Wide enough for the label
// and narrow enough that the page it turns into reads as a thumbnail.
//
// Its TOP LEFT is the desk gap below the last sheet at the sheet's own left
// edge, which is exactly where the next sheet's top left corner will be: the
// mini page and the page it becomes share that corner, so the growth is only
// ever downwards and to the right and the thing never jumps.
const W = 104;

// Appends a page break at the end of the document and puts the caret on the
// blank line that starts the new page.
//
// Whatever the document ends with, the marker ends up with a blank line in
// front of it: that is what makes it a break in every format, and it is tidier
// Fountain besides. An empty document needs nothing in front.
function addPage(view) {
  const doc = view.state.doc;
  const pos = doc.length;
  const tail = doc.sliceString(Math.max(0, doc.length - 2));
  const lead = doc.length === 0 ? ''
    : tail.endsWith('\n\n') ? ''
      : tail.endsWith('\n') ? '\n' : '\n\n';
  view.dispatch({
    changes: { from: pos, insert: lead + '===\n\n' },
    selection: { anchor: pos + lead.length + 4 },
    scrollIntoView: true,
  });
  view.focus();
}

class AddPageButton {
  constructor(view) {
    this.view = view;
    this.growing = false;
    this.at = null; // where the pill sits, and where the full page will be
    this.dom = document.createElement('div');
    this.dom.className = 'cm-addpage-layer';
    this.btn = document.createElement('button');
    this.btn.className = 'cm-addpage';
    this.btn.type = 'button';
    this.btn.title = 'Add a page (writes a page break into the document)';
    const label = document.createElement('span');
    label.className = 'cm-addpage-lbl';
    label.textContent = 'Add page';
    this.btn.appendChild(label);
    // mousedown, not click: CodeMirror would otherwise move the caret to
    // wherever the press landed before the button ever ran.
    this.btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.grow();
    });
    this.dom.appendChild(this.btn);
    view.scrollDOM.appendChild(this.dom);
    this.draw();
  }

  update(u) {
    if (u.docChanged || u.geometryChanged || u.viewportChanged
      || u.transactions.some((tr) => tr.effects.some((e) => e.is(setPageMetrics)))) this.draw();
  }

  draw() {
    // Never while it is growing: the animation owns the geometry until the
    // sheet it is becoming exists.
    if (this.growing) return;
    const { rects, geom } = sheetRects(this.view);
    const last = rects[rects.length - 1];
    if (!last) { this.btn.style.display = 'none'; return; }
    this.btn.style.display = '';
    // The mini page's height is the paper's own proportion at the pill's width,
    // so the thumbnail is the shape of the page it will become, A4 or Letter.
    const mini = Math.round(W * (geom.pageH / geom.pageW));
    this.btn.style.setProperty('--mini-h', mini + 'px');
    this.at = {
      left: last.left,
      top: last.top + last.height + geom.gap,
      mini,
      // Where the next sheet will be: the same place cm-pages.js will draw it,
      // one desk gap below this one, which is where the pill already sits.
      page: { left: last.left, top: last.top + last.height + geom.gap, width: geom.pageW, height: geom.pageH },
    };
    this.btn.style.width = W + 'px';
    this.btn.style.left = this.at.left + 'px';
    this.btn.style.top = this.at.top + 'px';
    this.btn.style.height = '';
  }

  // The press: the small page grows into the place the real page will take,
  // and the edit lands as it arrives, so the sheet appears exactly where the
  // thumbnail finished.
  grow() {
    if (this.growing) return;
    const at = this.at;
    if (!at || reducedMotion() || typeof this.btn.animate !== 'function') { addPage(this.view); return; }
    this.growing = true;
    this.btn.classList.add('growing');
    const to = at.page;
    const anim = this.btn.animate([
      { left: at.left + 'px', top: at.top + 'px', width: W + 'px', height: at.mini + 'px' },
      { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' },
    ], { duration: DUR[3], easing: EASE_OUT, fill: 'both' });
    const done = () => {
      anim.cancel();
      this.growing = false;
      this.btn.classList.remove('growing');
      addPage(this.view);
      this.draw();
    };
    anim.onfinish = done;
    // A browser that never fires onfinish (a backgrounded tab) must not leave
    // the button stuck mid-flight with the page unwritten.
    anim.oncancel = () => { if (this.growing) done(); };
  }

  destroy() {
    this.dom.remove();
  }
}

export function addPageButtons() {
  return ViewPlugin.fromClass(AddPageButton);
}

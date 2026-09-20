// The script's minimap: the same pages the editor shows, drawn small down its
// right edge, so a long screenplay stays scannable while you write.
//
// It replaces a generic code minimap (@replit/codemirror-minimap), which drew
// every line as one unwrapped strip, so a paragraph of action was a single
// long bar and the page had no shape. This one draws from the page layout
// itself (fountain/paginate.js, via cm-pages.js): real sheets, real wrapping at
// the real indents, scene headings in bold.
//
// Links are shown the way the editor shows them: not painted over the words but
// marked beside them. Each linked line gets a short bar in a gutter to the left
// of its page, one column per kind (storyboard, reference, comment), the same
// columns and colours as the markers in the editor's page margin. The kinds are
// read straight off the editor's own decorations, so the two can never
// disagree about what is linked.
//
// Canvas, so var() does not resolve; the colours are read off the editor's
// computed style on every draw, which is also how a theme change reaches it.
'use strict';

import { ViewPlugin, EditorView } from '@codemirror/view';
import { pagesField } from './cm-pages.js';
import { elementBox, wrapSegments, CPI } from '../../fountain/paginate.js';

export const MINIMAP_WIDTH = 92; // px, the minimap column
const PAD = 8;

// What kinds of link a highlight decoration carries. Only the link marks
// (those with a data-hl attribute) count; the line and emphasis decorations
// share the same set and mean nothing here.
export function kindsOfDecoration(deco) {
  const spec = deco && deco.spec;
  if (!spec || !spec.attributes || !spec.attributes['data-hl']) return null;
  const cls = spec.class || '';
  const board = /\bhb\b/.test(cls) ? 'final' : /\bhbr\b/.test(cls) ? 'ref' : null;
  const k = { board, ref: /\bhr\b/.test(cls), comment: /\bhc\b/.test(cls) };
  return k.board || k.ref || k.comment ? k : null;
}

// The gutter's bar colours, by kind and column.
const GUTTER = { board: '--board-strong', boardRef: '--act', ref: '--res', comment: '--act' };

const STYLE = {
  scene: { weight: '700', ink: '--ink' },
  character: { weight: '700', ink: '--ink' },
  paren: { weight: '400', ink: '--ui' },
  transition: { weight: '400', ink: '--ui' },
  lyric: { weight: '400', ink: '--ui' },
  synopsis: { weight: '400', ink: '--mut' },
  section: { weight: '700', ink: '--mut' },
};

export function scriptMinimap({ getHighlights }) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.dom = document.createElement('div');
      this.dom.className = 'cm-script-minimap';
      this.dom.setAttribute('aria-hidden', 'true');
      this.canvas = document.createElement('canvas');
      this.box = document.createElement('div');
      this.box.className = 'cm-script-minimap-view';
      this.dom.append(this.canvas, this.box);
      view.dom.appendChild(this.dom);
      this.raf = 0;
      this.drag = null;

      this.onScroll = () => this.schedule();
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : null;
      if (this.ro) this.ro.observe(this.dom);
      this.onDown = (e) => this.pointerDown(e);
      this.onMove = (e) => this.pointerMove(e);
      this.onUp = () => { this.drag = null; this.dom.classList.remove('dragging'); };
      this.dom.addEventListener('pointerdown', this.onDown);
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      this.schedule();
    }

    update() { this.schedule(); }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.ro) this.ro.disconnect();
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      this.dom.remove();
    }

    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
    }

    // The mapping between the editor's scroll and the minimap, the way a code
    // minimap does it: at the scale the pages are drawn, and when the whole
    // script is taller than the minimap, sliding it proportionally so its top
    // shows at the top of the script and its bottom at the bottom.
    geometry() {
      const { geom } = this.view.state.field(pagesField);
      const sd = this.view.scrollDOM;
      const width = this.dom.clientWidth - PAD * 2;
      const s = width / geom.pageW;
      const total = geom.count * (geom.pageH + geom.gap) * s;
      const viewH = this.dom.clientHeight;
      const range = Math.max(1, sd.scrollHeight - sd.clientHeight);
      const k = total > viewH ? (total - viewH) / range : 0;
      const contentTop = this.view.contentDOM.offsetTop;
      const offset = sd.scrollTop * k;
      return { geom, s, total, viewH, k, contentTop, offset, sd };
    }

    draw() {
      const { view } = this;
      const g = this.geometry();
      const { geom, s, offset } = g;
      const dpr = window.devicePixelRatio || 1;
      const w = this.dom.clientWidth;
      const h = this.dom.clientHeight;
      if (!w || !h) return;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
      }
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      this.dom.style.right = (g.sd.offsetWidth - g.sd.clientWidth) + 'px';
      const cs = getComputedStyle(view.dom);
      const color = (t) => cs.getPropertyValue(t).trim() || '#888';
      const font = cs.getPropertyValue('--script').trim() || 'monospace';
      const { layout } = view.state.field(pagesField);
      const doc = view.state.doc;
      const ppi = geom.ppi; // pixels per inch at the editor's current size
      const chW = ppi / CPI;
      const lh = geom.lh;
      const period = (geom.pageH + geom.gap) * s;
      const left = PAD;

      // Which lines carry which kinds of link, only for what is drawn.
      const firstPage = Math.max(0, Math.floor(offset / period));
      const lastPage = Math.min(layout.pages.length - 1, Math.floor((offset + h) / period));
      const firstLine = layout.pages[firstPage] ? layout.pages[firstPage].start : 0;
      const lastLine = lastPage + 1 < layout.pages.length ? layout.pages[lastPage + 1].start - 1 : doc.lines - 1;
      const lineKinds = new Map();
      const hl = getHighlights(view);
      if (hl && doc.lines) {
        const from = doc.line(Math.min(firstLine + 1, doc.lines)).from;
        const to = doc.line(Math.min(lastLine + 1, doc.lines)).to;
        hl.between(from, to, (f, t, deco) => {
          const k = kindsOfDecoration(deco);
          if (!k) return;
          for (let n = doc.lineAt(f).number; n <= doc.lineAt(t).number; n++) {
            const cur = lineKinds.get(n - 1) || { board: null, ref: false, comment: false };
            if (k.board === 'final') cur.board = 'final'; else if (k.board && !cur.board) cur.board = 'ref';
            if (k.ref) cur.ref = true;
            if (k.comment) cur.comment = true;
            lineKinds.set(n - 1, cur);
          }
        });
      }

      const sheet = color('--field');
      const edge = color('--ph');
      for (let p = firstPage; p <= lastPage; p++) {
        const top = p * period - offset;
        ctx.fillStyle = sheet;
        ctx.fillRect(left, top, geom.pageW * s, geom.pageH * s);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, geom.pageW * s - 1, geom.pageH * s - 1);

        const pg = layout.pages[p];
        const end = p + 1 < layout.pages.length ? layout.pages[p + 1].start : doc.lines;
        for (let i = pg.start; i < end; i++) {
          const type = layout.types[i];
          const kinds = lineKinds.get(i);
          if (kinds) {
            // A short bar per kind, in its own column, in the gutter left of the page.
            const y0 = top + (geom.top + layout.rowOf[i] * lh) * s;
            const hh = Math.max(2, layout.rowsOf[i] * lh * s);
            const bar = (col, token) => { ctx.fillStyle = color(token); ctx.fillRect(left - 8 + col * 3, y0, 2, hh); };
            if (kinds.board) bar(0, kinds.board === 'final' ? GUTTER.board : GUTTER.boardRef);
            if (kinds.ref) bar(1, GUTTER.ref);
            if (kinds.comment) bar(2, GUTTER.comment);
          }
          if (type === 'blank' || type === 'page') continue;
          const text = doc.line(i + 1).text;
          if (!text.trim()) continue;
          const box = elementBox(type, layout.cols, layout.refCols);
          const segs = wrapSegments(text, box.width);
          const st = STYLE[type] || { weight: '400', ink: '--ink' };
          segs.forEach(([a, b], r) => {
            const len = b - a;
            let col = box.indent;
            if (type === 'transition') col = layout.cols - len;
            else if (type === 'centered') col = Math.floor((layout.cols - len) / 2);
            const x = left + (geom.left + col * chW) * s;
            const y = top + (geom.top + (layout.rowOf[i] + r) * lh) * s;
            ctx.fillStyle = color(st.ink);
            ctx.font = `${st.weight} ${Math.max(1.5, lh * s * 0.95)}px ${font}`;
            ctx.textBaseline = 'top';
            let str = text.slice(a, b);
            if (type === 'scene' || type === 'character' || type === 'transition') str = str.toUpperCase();
            ctx.fillText(str, x, y, len * chW * s + 1);
          });
        }
      }

      // The part of the script the editor is showing.
      const sd = g.sd;
      const boxTop = (sd.scrollTop - g.contentTop) * s - offset;
      this.box.style.transform = `translateY(${Math.round(boxTop)}px)`;
      this.box.style.height = Math.max(8, sd.clientHeight * s) + 'px';
    }

    // Click: centre the editor on that point of the script. Press on the
    // viewport box and drag: move through the script with it.
    pointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const g = this.geometry();
      const rect = this.dom.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const boxRect = this.box.getBoundingClientRect();
      const onBox = e.clientY >= boxRect.top && e.clientY <= boxRect.bottom;
      if (!onBox) {
        const docY = (y + g.offset) / g.s + g.contentTop;
        g.sd.scrollTop = docY - g.sd.clientHeight / 2;
      }
      this.drag = { grab: y - (boxRect.top - rect.top) };
      this.dom.classList.add('dragging');
      this.dom.setPointerCapture && this.dom.setPointerCapture(e.pointerId);
    }

    pointerMove(e) {
      if (!this.drag) return;
      const g = this.geometry();
      const rect = this.dom.getBoundingClientRect();
      const boxTop = e.clientY - rect.top - this.drag.grab;
      // boxTop = (scrollTop - contentTop) * s - scrollTop * k, solved for scrollTop.
      const denom = g.s - g.k;
      if (denom <= 0) return;
      g.sd.scrollTop = (boxTop + g.contentTop * g.s) / denom;
    }
  });
}

// The minimap's column, and the space the scroller keeps free for it so a
// page is centred in what is left and never sits underneath the minimap.
export const scriptMinimapTheme = EditorView.theme({
  '.cm-scroller': { paddingRight: MINIMAP_WIDTH + 'px' },
  '.cm-script-minimap': {
    position: 'absolute', top: '0', bottom: '0', right: '0', width: MINIMAP_WIDTH + 'px', zIndex: '3',
    cursor: 'pointer', userSelect: 'none', touchAction: 'none',
  },
  '.cm-script-minimap canvas': { display: 'block' },
  // What the editor is showing: a soft band, firmer when the minimap is
  // hovered or dragged, so it reads as the handle it is.
  '.cm-script-minimap-view': {
    position: 'absolute', left: '4px', right: '4px', top: '0', borderRadius: '6px', pointerEvents: 'none',
    background: 'color-mix(in srgb, var(--ui) 9%, transparent)',
    transition: 'background var(--dur-1) var(--ease-out)',
  },
  '.cm-script-minimap:hover .cm-script-minimap-view, .cm-script-minimap.dragging .cm-script-minimap-view': {
    background: 'color-mix(in srgb, var(--ui) 16%, transparent)',
  },
});

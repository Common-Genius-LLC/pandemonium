// Section affordances: the hover model that lets a whole Fountain "section"
// be boarded/sourced/commented in one click, instead of forcing a precise
// text selection (notes.md point c). A "section" is a Fountain block group,
// NOT a raw line-break split: a character cue and its dialogue/parenthetical
// lines are one section, a scene heading is one, each action paragraph is one.
// Grouping by the parser's own blocks (parse.js) is what keeps this honest --
// the same structure the timeline and anchors already use -- and it means a
// stray one-word selection can never masquerade as a linkable unit.
//
// Pure overlay, like cm-fountain-plugin: it only adds a background band (line
// decorations, so they sit behind the text and scroll with it for free) plus
// one floating button rail; it never edits the document.
'use strict';

import { ViewPlugin, Decoration } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

export const setHoverSection = StateEffect.define();

// Which section index the pointer is currently over (-1 = none). Kept in
// editor state so the decoration builder is a pure function of state.
export const hoverSectionField = StateField.define({
  create: () => -1,
  update(value, tr) {
    // Editing dismisses the hover band/rail until the pointer moves again, so
    // it never hovers over the words you're actively typing.
    if (tr.docChanged) value = -1;
    for (const e of tr.effects) if (e.is(setHoverSection)) value = e.value;
    return value;
  },
});

export const setPinnedSection = StateEffect.define();

// While a rail menu (link to / element / comment) is open, the section it was
// opened from stays lit and its rail stays visible even as the pointer leaves
// the row to reach the menu (item 3). The editor pins on menu open and clears
// on the next click. -1 = nothing pinned; when set it wins over the live hover.
export const pinnedSectionField = StateField.define({
  create: () => -1,
  update(value, tr) {
    if (tr.docChanged) value = -1;
    for (const e of tr.effects) if (e.is(setPinnedSection)) value = e.value;
    return value;
  },
});

// The section the band/rail should show: a pin (an open menu) wins over the
// live pointer hover, so the row does not go dark while the menu is being used.
function effectiveSection(state) {
  const pinned = state.field(pinnedSectionField);
  return pinned >= 0 ? pinned : state.field(hoverSectionField);
}

// One row per parsed block, with one grouping: a character cue and each
// parenthetical are their own rows (they are separate elements), but the
// consecutive dialogue lines of a single speech collapse into ONE taller row,
// the way a wrapped or soft-broken paragraph is one row. Every parser block is
// exactly one document line (parse.js pushes a block per line), so a multi-line
// speech is several dialogue blocks in a run; grouping them keeps the speech a
// single hoverable, linkable paragraph element (Figma node 101-471).
export function computeSections(parsed) {
  const blocks = parsed.blocks;
  const has = (b) => b && b.type !== 'page' && b.line != null && b.plain && b.plain.trim();
  const sections = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (!has(b)) { i++; continue; }
    if (b.type === 'dialogue') {
      const group = [b];
      i++;
      while (i < blocks.length && blocks[i].type === 'dialogue' && has(blocks[i])) { group.push(blocks[i]); i++; }
      sections.push({
        firstLine: group[0].line,
        lastLine: group[group.length - 1].line,
        kind: 'dialogue',
        parts: group.map((g) => ({ q: g.plain, b: g.i, s: 0 })),
      });
      continue;
    }
    sections.push({ firstLine: b.line, lastLine: b.line, kind: b.type, parts: [{ q: b.plain, b: b.i, s: 0 }] });
    i++;
  }
  return sections;
}

// `getParsed(view)` returns the current parseFountain() result (the editor
// passes the shared fountain plugin's `.parsed` so we never parse twice).
// `onAct(actName, section)` runs a direct action (comment). `onLink(section,
// rect)` opens the "link to" menu (Storyboard / Research / Sound) anchored to
// the pill. `canLink()` gates the link and comment pills (and image-drop-to-
// board) off when the shown draft is not the final one, since only the final
// draft owns links -- but the rail itself still shows, with just its element
// pill, on every draft: changing a line's screenplay element (Scene, Action,
// Character, ...) has nothing to do with linking. A text selection hides the
// whole rail regardless (the selection toolbar owns that case).
//
// The rail is the Figma "Paragraph Element (Hover)" affordance (node 85-590):
// an element pill plus a dark "link to" pill and a yellow "Comment" pill at
// the row's right edge, replacing the older Board/Source/Comment button row.
// The linkable unit is still a parsed section (a paragraph, or a cue with its
// speech), which is the honest anchor unit -- the pills just re-dress how it
// is reached.
export function sectionAffordances({ getParsed, onAct, onLink, onElement, onDropImage, elementLabelForSection, canLink }) {
  // canLink: the draft can take storyboards and comments (the final draft).
  // Every draft can link a reference, so the link pill always shows.
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.sections = computeSections(getParsed(view));
      this.decorations = this.build(view);
      this.elementLabelForSection = elementLabelForSection;

      this.acts = document.createElement('div');
      this.acts.className = 'cm-sec-acts';
      this.acts.style.display = 'none';
      this.acts.innerHTML =
        '<button class="elt" data-act="element" title="Change this line\'s screenplay element"></button>' +
        '<button class="linkto" data-act="link" title="Link this passage to a storyboard, reference, or sound">link to</button>' +
        '<button class="comment" data-act="comment" title="Add a comment on this passage">Comment</button>';
      this.eltBtn = this.acts.querySelector('.elt');
      this.linkBtn = this.acts.querySelector('.linkto');
      this.commentBtn = this.acts.querySelector('.comment');
      // Keep the editor's selection/focus intact when a rail button is used.
      this.acts.addEventListener('mousedown', (e) => e.preventDefault());
      this.acts.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const sec = this.sections[view.state.field(hoverSectionField)];
        if (!sec) return;
        if (btn.dataset.act === 'link') onLink(sec, btn.getBoundingClientRect());
        else if (btn.dataset.act === 'element') onElement(sec, btn.getBoundingClientRect());
        else onAct(btn.dataset.act, sec, btn.getBoundingClientRect());
      });
      view.scrollDOM.appendChild(this.acts);

      this.onMove = (e) => this.onMouseMove(e);
      this.onLeave = () => this.setHover(-1);
      view.scrollDOM.addEventListener('mousemove', this.onMove);
      view.scrollDOM.addEventListener('mouseleave', this.onLeave);

      // Dropping an image onto a paragraph boards it (see onDropImage). The
      // hovered row lights pink during the drag (cm-theme .img-drag rule).
      this.onDragOver = (e) => {
        if (!onDropImage || !this.canLink() || !(e.dataTransfer && [...e.dataTransfer.types].includes('Files'))) return;
        const idx = this.sectionAt(e.clientX, e.clientY);
        if (idx < 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        view.scrollDOM.classList.add('img-drag');
        this.setHover(idx);
      };
      this.onDragLeave = (e) => {
        if (e.relatedTarget && view.scrollDOM.contains(e.relatedTarget)) return;
        view.scrollDOM.classList.remove('img-drag');
      };
      this.onDrop = (e) => {
        view.scrollDOM.classList.remove('img-drag');
        if (!onDropImage || !this.canLink()) return;
        const file = [...((e.dataTransfer && e.dataTransfer.files) || [])].find((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
        if (!file) return;
        const idx = this.sectionAt(e.clientX, e.clientY);
        const sec = this.sections[idx];
        if (!sec) return;
        e.preventDefault();
        e.stopPropagation();
        onDropImage(sec, file);
      };
      view.scrollDOM.addEventListener('dragover', this.onDragOver);
      view.scrollDOM.addEventListener('dragleave', this.onDragLeave);
      view.scrollDOM.addEventListener('drop', this.onDrop);

      this.canLink = canLink;
      this.getParsed = getParsed;
    }

    // The section index under a viewport point, or -1. Shared by hover and the
    // image-drop drag feedback.
    sectionAt(clientX, clientY) {
      const pos = this.view.posAtCoords({ x: clientX, y: clientY }, false);
      if (pos == null) return -1;
      const line = this.view.state.doc.lineAt(pos).number - 1;
      const idx = this.sections.findIndex((s) => line >= s.firstLine && line <= s.lastLine);
      if (idx < 0) return -1;
      const sec = this.sections[idx];
      const top = this.lineCoords(sec.firstLine, 'top');
      const bottom = this.lineCoords(sec.lastLine, 'bottom');
      if (top == null || bottom == null || clientY < top - 2 || clientY > bottom + 2) return -1;
      return idx;
    }

    onMouseMove(e) {
      // Over the rail itself: hold the current section so the click lands.
      if (this.acts.contains(e.target)) return;
      // The rail shows on every draft now (element pill at minimum), so only
      // an active selection (the selection toolbar's turf) hides it.
      if (!this.view.state.selection.main.empty) { this.setHover(-1); return; }
      this.setHover(this.sectionAt(e.clientX, e.clientY));
    }

    setHover(idx) {
      if (this.view.state.field(hoverSectionField) === idx) return;
      this.view.dispatch({ effects: setHoverSection.of(idx) });
    }

    lineCoords(line0, edge) {
      const doc = this.view.state.doc;
      if (line0 + 1 > doc.lines) return null;
      const c = this.view.coordsAtPos(doc.line(line0 + 1).from);
      return c ? c[edge] : null;
    }

    build(view) {
      const idx = effectiveSection(view.state);
      const builder = new RangeSetBuilder();
      // While a passage is selected, the selection toolbar owns the surface;
      // don't also paint a section band under it.
      const sec = view.state.selection.main.empty ? this.sections[idx] : null;
      if (sec) {
        const doc = view.state.doc;
        for (let ln = sec.firstLine; ln <= sec.lastLine && ln + 1 <= doc.lines; ln++) {
          const line = doc.line(ln + 1);
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-sec-hover' }));
        }
      }
      return builder.finish();
    }

    update(update) {
      if (update.docChanged) this.sections = computeSections(this.getParsed(update.view));
      this.decorations = this.build(update.view);
      this.requestPosition(update.view);
    }

    requestPosition(view) {
      view.requestMeasure({
        read: (v) => {
          const idx = effectiveSection(v.state);
          const sec = this.sections[idx];
          if (!sec || !v.state.selection.main.empty) return { show: false };
          const doc = v.state.doc;
          if (sec.firstLine + 1 > doc.lines) return { show: false };
          const coords = v.coordsAtPos(doc.line(sec.firstLine + 1).from);
          if (!coords) return { show: false };
          const scRect = v.scrollDOM.getBoundingClientRect();
          const contentRect = v.contentDOM.getBoundingClientRect();
          // Anchored to the page's right edge, not the scroller's: the page
          // is narrower than the scroller (centered on a desk) and the
          // minimap sits inside the scroller's right edge, so a fixed
          // right:10px put the rail under the minimap.
          let right = scRect.right - contentRect.right + 10;
          // A transition is right-aligned, so its text sits exactly where the
          // rail does and the rail covers it: it could not be clicked. The rail
          // moves to just left of that text instead; if there is no room there
          // (a narrow page, a long transition) it is centred on the page, which
          // still clears a right-aligned line.
          const first = this.getParsed(v).blocks.find((b) => b.line === sec.firstLine);
          if (first && first.type === 'transition') {
            const railW = this.acts.offsetWidth || 260;
            const start = v.coordsAtPos(doc.line(sec.firstLine + 1).from + (first.textOffset || 0));
            const roomLeft = start ? start.left - 14 - railW : -1;
            if (start && roomLeft >= contentRect.left + 8) right = scRect.right - (start.left - 14);
            else right = scRect.right - (contentRect.left + (contentRect.width + railW) / 2);
          }
          return {
            show: true,
            top: Math.max(0, coords.top - scRect.top + v.scrollDOM.scrollTop),
            right,
            label: this.elementLabelForSection ? this.elementLabelForSection(sec) : '',
          };
        },
        write: (data) => {
          if (!data || !data.show) { this.acts.style.display = 'none'; return; }
          this.acts.style.display = 'flex';
          this.acts.style.top = data.top + 'px';
          this.acts.style.right = data.right + 'px';
          if (this.eltBtn) this.eltBtn.textContent = data.label || 'Element';
          // Every draft can link a reference, so the link pill always shows;
          // a comment (like a storyboard) belongs to the final draft only.
          if (this.linkBtn) this.linkBtn.style.display = '';
          if (this.commentBtn) this.commentBtn.style.display = this.canLink() ? '' : 'none';
        },
      });
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('mousemove', this.onMove);
      this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave);
      this.view.scrollDOM.removeEventListener('dragover', this.onDragOver);
      this.view.scrollDOM.removeEventListener('dragleave', this.onDragLeave);
      this.view.scrollDOM.removeEventListener('drop', this.onDrop);
      this.acts.remove();
    }
  }, { decorations: (v) => v.decorations });
}

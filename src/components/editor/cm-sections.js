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

// Group parsed blocks into sections. Each section carries the doc line range
// it spans (0-based, matching block.line) and the anchor `parts` that linking
// a whole section produces -- one {q, b, s:0} per content block, so it
// resolves exactly like a hand-made multi-block selection.
export function computeSections(parsed) {
  const blocks = parsed.blocks;
  const sections = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'page' || b.line == null) { i++; continue; }
    const group = [b];
    if (b.type === 'character') {
      i++;
      while (i < blocks.length && (blocks[i].type === 'dialogue' || blocks[i].type === 'paren')) { group.push(blocks[i]); i++; }
    } else {
      i++;
    }
    const contentBlocks = group.filter((g) => g.plain && g.plain.trim());
    if (!contentBlocks.length) continue;
    sections.push({
      firstLine: group[0].line,
      lastLine: group[group.length - 1].line,
      kind: b.type,
      parts: contentBlocks.map((g) => ({ q: g.plain, b: g.i, s: 0 })),
    });
  }
  return sections;
}

// `getParsed(view)` returns the current parseFountain() result (the editor
// passes the shared fountain plugin's `.parsed` so we never parse twice).
// `onAct(actName, section)` runs the chosen action. `canLink()` gates the
// whole thing off when the shown draft is not the final one (only the final
// draft owns links) or when a text selection is active (the selection toolbar
// owns that case).
export function sectionAffordances({ getParsed, onAct, canLink }) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.sections = computeSections(getParsed(view));
      this.decorations = this.build(view);

      this.acts = document.createElement('div');
      this.acts.className = 'cm-sec-acts';
      this.acts.style.display = 'none';
      this.acts.innerHTML =
        '<button class="b" data-act="board" title="Attach a storyboard image to this whole section">Board</button>' +
        '<button class="r" data-act="source" title="Link a source or research passage to this whole section">Source</button>' +
        '<button class="n" data-act="comment" title="Add a comment on this whole section">Comment</button>';
      // Keep the editor's selection/focus intact when a rail button is used.
      this.acts.addEventListener('mousedown', (e) => e.preventDefault());
      this.acts.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const sec = this.sections[view.state.field(hoverSectionField)];
        if (sec) onAct(btn.dataset.act, sec);
      });
      view.scrollDOM.appendChild(this.acts);

      this.onMove = (e) => this.onMouseMove(e);
      this.onLeave = () => this.setHover(-1);
      view.scrollDOM.addEventListener('mousemove', this.onMove);
      view.scrollDOM.addEventListener('mouseleave', this.onLeave);

      this.canLink = canLink;
      this.getParsed = getParsed;
    }

    onMouseMove(e) {
      // Over the rail itself: hold the current section so the click lands.
      if (this.acts.contains(e.target)) return;
      if (!this.canLink() || !this.view.state.selection.main.empty) { this.setHover(-1); return; }
      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
      if (pos == null) { this.setHover(-1); return; }
      const line = this.view.state.doc.lineAt(pos).number - 1;
      const idx = this.sections.findIndex((s) => line >= s.firstLine && line <= s.lastLine);
      if (idx < 0) { this.setHover(-1); return; }
      // Guard against posAtCoords snapping to the nearest line when the pointer
      // is in the tall bottom padding: require the pointer inside the band.
      const sec = this.sections[idx];
      const top = this.lineCoords(sec.firstLine, 'top');
      const bottom = this.lineCoords(sec.lastLine, 'bottom');
      if (top == null || bottom == null || e.clientY < top - 2 || e.clientY > bottom + 2) { this.setHover(-1); return; }
      this.setHover(idx);
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
      const idx = view.state.field(hoverSectionField);
      const builder = new RangeSetBuilder();
      // While a passage is selected, the selection toolbar owns the surface;
      // don't also paint a section band under it.
      const sec = view.state.selection.main.empty ? this.sections[idx] : null;
      if (sec) {
        const doc = view.state.doc;
        for (let ln = sec.firstLine; ln <= sec.lastLine && ln + 1 <= doc.lines; ln++) {
          const line = doc.line(ln + 1);
          const pos = sec.firstLine === sec.lastLine ? 'solo' : (ln === sec.firstLine ? 'first' : (ln === sec.lastLine ? 'last' : 'mid'));
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-sec-hover', attributes: { 'data-secpos': pos } }));
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
          const idx = v.state.field(hoverSectionField);
          const sec = this.sections[idx];
          if (!sec || !this.canLink() || !v.state.selection.main.empty) return { show: false };
          const doc = v.state.doc;
          if (sec.firstLine + 1 > doc.lines) return { show: false };
          const coords = v.coordsAtPos(doc.line(sec.firstLine + 1).from);
          if (!coords) return { show: false };
          const scRect = v.scrollDOM.getBoundingClientRect();
          return {
            show: true,
            top: Math.max(0, coords.top - scRect.top + v.scrollDOM.scrollTop),
          };
        },
        write: (data) => {
          if (!data || !data.show) { this.acts.style.display = 'none'; return; }
          this.acts.style.display = 'flex';
          this.acts.style.top = data.top + 'px';
        },
      });
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('mousemove', this.onMove);
      this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave);
      this.acts.remove();
    }
  }, { decorations: (v) => v.decorations });
}

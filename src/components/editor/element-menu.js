// The element list Final Draft pops up when you press Enter on an empty line,
// rebuilt here as a VS Code-style autocomplete dropdown anchored to the caret.
// Letter shortcuts and rows come from ELEMENT_SHORTCUTS (element-ops.js).
//
// It is pure UI over the element vocabulary: picking a row goes through the
// same applyElement path the picker and Tab use, so the menu cannot introduce
// anything the Fountain source can't hold. Styling lives in cm-theme.js with
// the rest of the editor chrome.
//
// Built by hand rather than on @codemirror/autocomplete: this is not
// completing what you typed (there is nothing on the line), it is a fixed
// element chooser, and the package is not a dependency of this project.
'use strict';

import { StateField, StateEffect, Prec } from '@codemirror/state';
import { ViewPlugin, EditorView, keymap } from '@codemirror/view';
import { ELEMENT_SHORTCUTS } from '../../fountain/element-ops.js';

// null when closed, else {pos: line start it is anchored to, index: highlighted row}.
export const setElementMenu = StateEffect.define();

export const elementMenuField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setElementMenu)) value = e.value;
    if (!value) return null;
    if (tr.docChanged) value = { pos: tr.changes.mapPos(value.pos, -1), index: value.index };
    // Moving the caret off the line the menu belongs to dismisses it.
    if (tr.selection) {
      const doc = tr.newDoc;
      const anchored = doc.lineAt(Math.min(value.pos, doc.length)).from;
      if (doc.lineAt(tr.newSelection.main.head).from !== anchored) return null;
    }
    return value;
  },
});

export function elementMenuOpen(state) { return state.field(elementMenuField, false) || null; }

// `el` is the element key the caret is already in, so the menu opens with that
// row highlighted (Action on a fresh line, Dialogue on the line under a cue).
export function openElementMenu(view, pos, el) {
  const at = ELEMENT_SHORTCUTS.findIndex((it) => it.el === el);
  view.dispatch({ effects: setElementMenu.of({ pos, index: at < 0 ? 0 : at }) });
  return true;
}

export function closeElementMenu(view) {
  if (!elementMenuOpen(view.state)) return false;
  view.dispatch({ effects: setElementMenu.of(null) });
  return true;
}

function moveSelection(view, d) {
  const st = elementMenuOpen(view.state);
  if (!st) return false;
  const n = ELEMENT_SHORTCUTS.length;
  view.dispatch({ effects: setElementMenu.of({ pos: st.pos, index: (st.index + d + n) % n }) });
  return true;
}

function pick(view, item, onPick) {
  closeElementMenu(view);
  if (item) onPick(view, item.el);
  view.focus();
  return true;
}

// One keydown handler for the whole menu, at the highest precedence so Enter,
// Tab and the letter keys reach it before the element keymap and the default
// keymap. Everything is a no-op while the menu is closed.
function handleKey(view, event, onPick) {
  const st = elementMenuOpen(view.state);
  if (!st) return false;
  const k = event.key;
  if (k === 'Escape') return closeElementMenu(view);
  if (k === 'ArrowDown') return moveSelection(view, 1);
  if (k === 'ArrowUp') return moveSelection(view, -1);
  if (k === 'Enter') return pick(view, ELEMENT_SHORTCUTS[st.index], onPick);
  // Tab closes and falls through, so it goes on cycling elements as usual.
  if (k === 'Tab') { closeElementMenu(view); return false; }
  if (k.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const hit = ELEMENT_SHORTCUTS.find((it) => it.k.toLowerCase() === k.toLowerCase());
    if (hit) return pick(view, hit, onPick);
    // Any other character: dismiss and let it type, so the menu never eats
    // the first letter of a line you decided to just write.
    closeElementMenu(view);
  }
  return false;
}

// Walk up from an event target (which can be a text node) to the nearest
// element matching `cls`, or null.
function inClass(node, cls) {
  for (let n = node; n; n = n.parentNode) if (n.classList && n.classList.contains(cls)) return n;
  return null;
}

function menuPlugin(onPick) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.dom = null;
      this.render();
    }

    update(u) {
      const changed = elementMenuOpen(u.state) !== elementMenuOpen(u.startState);
      if (changed || u.geometryChanged || u.docChanged) this.render();
    }

    render() {
      const st = elementMenuOpen(this.view.state);
      if (!st) { this.destroy(); return; }
      if (!this.dom) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-elmenu';
        this.dom.addEventListener('mousedown', (e) => {
          const row = inClass(e.target, 'cm-elmenu-row');
          e.preventDefault(); // keep the caret where it is
          if (row) pick(this.view, ELEMENT_SHORTCUTS[Number(row.dataset.ix)], onPick);
        });
        // Into the scroller, positioned the same way the section rail is
        // (cm-sections.js): it then stays pinned to its line if the script
        // scrolls under it.
        this.view.scrollDOM.appendChild(this.dom);
      }
      this.dom.innerHTML = ELEMENT_SHORTCUTS.map((it, i) => (
        `<div class="cm-elmenu-row${i === st.index ? ' sel' : ''}" data-ix="${i}">`
        + `<span class="cm-elmenu-k">[${it.k}]</span>`
        + `<span class="cm-elmenu-l">${it.label}</span>`
        + `<span class="cm-elmenu-w">${it.writes}</span>`
        + '</div>'
      )).join('');
      this.position(st);
      // Scroll the highlighted row into view by hand rather than with
      // scrollIntoView, which would also scroll the editor underneath.
      const sel = this.dom.querySelector('.sel');
      if (sel) {
        const top = sel.offsetTop, bottom = top + sel.offsetHeight;
        if (top < this.dom.scrollTop) this.dom.scrollTop = top;
        else if (bottom > this.dom.scrollTop + this.dom.clientHeight) this.dom.scrollTop = bottom - this.dom.clientHeight;
      }
    }

    // Anchored under the caret line, flipped above it when the window has no
    // room below, and clamped so it never hangs off the side of the panel.
    position(st) {
      const doc = this.view.state.doc;
      const coords = this.view.coordsAtPos(Math.min(st.pos, doc.length));
      if (!coords) return;
      const sc = this.view.scrollDOM;
      const box = sc.getBoundingClientRect();
      const h = this.dom.offsetHeight || 0;
      const flip = window.innerHeight - coords.bottom < h + 12 && coords.top > h + 12;
      const left = coords.left - box.left + sc.scrollLeft;
      const top = (flip ? coords.top - h - 4 : coords.bottom + 4) - box.top + sc.scrollTop;
      this.dom.style.left = Math.max(0, Math.min(left, box.width - this.dom.offsetWidth - 8)) + 'px';
      this.dom.style.top = Math.max(0, top) + 'px';
    }

    destroy() {
      if (this.dom) { this.dom.remove(); this.dom = null; }
    }
  });
}

// `onPick(view, elementKey)` applies the chosen element to the caret line.
export function elementMenu({ onPick }) {
  return [
    elementMenuField,
    menuPlugin(onPick),
    Prec.highest(keymap.of([{ any: (view, event) => handleKey(view, event, onPick) }])),
    EditorView.domEventHandlers({
      mousedown: (e, view) => { if (!inClass(e.target, 'cm-elmenu')) closeElementMenu(view); return false; },
      blur: (e, view) => { closeElementMenu(view); return false; },
    }),
  ];
}

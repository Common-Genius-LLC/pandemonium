'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { clamp } from '../utils/format.js';
import { defaultLayout, setRatio, splitLeaf, splitLeafAt, closeLeaf, absorbSibling, siblingSubtree, leafCount } from '../data/layout-tree.js';
import '../components/boards/boards-panel.js';
import '../components/research/research-panel.js';
import '../components/editor/script-panel.js';
import './timeline.js';

// Blender-style window division (see data/layout-tree.js). The panels are laid
// out by recursively rendering a binary split tree from project.layout: each
// split is a flex row/column of two panes with a draggable border between them;
// each leaf hosts a panel whose header dropdown switches its content.
//
// Two gestures, and they are the same gesture in Blender:
//   - drag a CORNER grip inward: split this pane. The drag axis picks the
//     direction, the release point picks the ratio, and the corner picks which
//     side the new pane lands on.
//   - drag a corner grip outward, past the divider: merge. This pane swallows
//     everything across its own divider.
// The buttons along the bottom edge do the same two things without a drag,
// because a drag-only affordance is unreachable from a keyboard.
export class PandemoniumPanelLayout extends LitElement {
  // Below this, a corner drag is a click that happened to wobble.
  static GESTURE_THRESHOLD = 18;

  static styles = css`
    :host{flex:1;min-height:0;display:flex;padding:0 22px 18px}
    .split{display:flex;flex:1;min-width:0;min-height:0}
    .split.row{flex-direction:row}
    .split.col{flex-direction:column}
    /* Not overflow:hidden. The panel shell does its own clipping (see
       styles/shared.js), and hiding overflow here cropped the shell's drop
       shadow flush against its rounded corners, so the panels read as square
       blocks butted together. min-width/min-height:0 is what actually keeps a
       pane from being pushed wider by its content. */
    .pane{display:flex;min-width:0;min-height:0}
    .leaf{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
    pandemonium-boards-panel,pandemonium-research-panel,pandemonium-script-panel,pandemonium-timeline{
      flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;
    }

    .divider{flex:none;position:relative;z-index:3}
    .divider::after{content:"";position:absolute;background:transparent;border-radius:3px;transition:background .12s}
    .divider.v{width:16px;cursor:col-resize}
    .divider.v::after{inset:0 7px}
    .divider.h{height:16px;cursor:row-resize}
    .divider.h::after{inset:7px 0}
    .divider:hover::after{background:var(--ph)}
    /* The dragging class is set on the one divider the pointer went down on,
       so only the border actually being resized goes pink, not every border
       in the layout. */
    .divider.dragging::after{background:var(--res)}

    /* Corner grips. Small, and only visible on hover, because they sit over
       the panel's own content and a permanently visible handle in all four
       corners of every pane is visual noise on a page that is mostly text. */
    .grip{position:absolute;width:15px;height:15px;z-index:9;opacity:0;transition:opacity .12s}
    .leaf:hover .grip{opacity:1}
    .grip::after{content:"";position:absolute;inset:4px;background:var(--ui);opacity:.3;border-radius:1px}
    .grip:hover::after{opacity:.65}
    .grip.tl{top:0;left:0;cursor:nwse-resize}
    .grip.tr{top:0;right:0;cursor:nesw-resize}
    .grip.bl{bottom:0;left:0;cursor:nesw-resize}
    .grip.br{bottom:0;right:0;cursor:nwse-resize}

    /* Centered on the bottom edge, clear of all four grips. */
    .regionctl{
      position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:9;
      display:flex;gap:2px;opacity:0;transition:opacity .12s;pointer-events:none;
    }
    .leaf:hover .regionctl{opacity:1;pointer-events:auto}
    .regionctl button{
      width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;
      color:var(--ui);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    .regionctl button:hover{background:var(--ph)}
    .regionctl button.close:hover{background:var(--danger);color:#fff}

    /* Live gesture preview. Positioned in viewport coordinates and painted
       over everything, so nothing in the tree has to re-render per pointer
       move: the same discipline the divider drag already follows. */
    .ghost{position:fixed;z-index:40;pointer-events:none;border-radius:4px;background:var(--pend);opacity:.6}
    .ghost.merge{background:var(--res);opacity:.28}

    @media (max-width:1100px){
      :host{display:block;overflow:auto;padding:0 14px 14px}
      .split,.split.row,.split.col{display:flex;flex-direction:column}
      .pane{flex:none!important;min-height:300px}
      .divider{display:none}
      /* A stacked layout has no dividers to drag a corner across, so the
         gesture has nothing to mean here. */
      .grip{display:none}
    }
    @media (max-width:700px){
      :host{padding:0 10px 10px}
      .pane{min-height:240px}
    }
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  disconnectedCallback() { this.#endDrag(); super.disconnectedCallback(); }

  #layout() {
    const project = this._store.project;
    return (project && project.layout) || defaultLayout();
  }

  #commit(layout) { this._store.store.setLayout(layout); }

  #node(node) {
    if (node.type === 'leaf') return this.#leaf(node);
    const isRow = node.dir === 'row';
    return html`
      <div class="split ${isRow ? 'row' : 'col'}">
        <div class="pane" style="flex:${node.ratio} 1 0">${this.#node(node.a)}</div>
        <div class="divider ${isRow ? 'v' : 'h'}" @pointerdown=${(e) => this.#startDrag(e, node.id, isRow ? 'x' : 'y')}></div>
        <div class="pane" style="flex:${1 - node.ratio} 1 0">${this.#node(node.b)}</div>
      </div>`;
  }

  #leaf(node) {
    const canClose = leafCount(this.#layout()) > 1;
    return html`
      <div class="leaf" data-leaf=${node.id}>
        ${this.#panelFor(node)}
        ${['tl', 'tr', 'bl', 'br'].map((c) => html`
          <div class="grip ${c}" title="Drag inward to split this pane, outward to merge it with its neighbour"
            @pointerdown=${(e) => this.#startCorner(e, node.id, c)}></div>`)}
        <div class="regionctl">
          <button title="Split this pane left / right" @click=${() => this.#split(node.id, 'row')}>▯▯</button>
          <button title="Split this pane top / bottom" @click=${() => this.#split(node.id, 'col')}>▤</button>
          ${canClose ? html`<button class="close" title="Close this pane" @click=${() => this.#close(node.id)}>✕</button>` : ''}
        </div>
      </div>`;
  }

  #panelFor(node) {
    if (node.content === 'boards') return html`<pandemonium-boards-panel .leafId=${node.id}></pandemonium-boards-panel>`;
    if (node.content === 'research') return html`<pandemonium-research-panel .leafId=${node.id}></pandemonium-research-panel>`;
    if (node.content === 'timeline') return html`<pandemonium-timeline .leafId=${node.id}></pandemonium-timeline>`;
    return html`<pandemonium-script-panel .leafId=${node.id}></pandemonium-script-panel>`;
  }

  #split(id, dir) { this.#commit(splitLeaf(this.#layout(), id, dir)); }

  #close(id) {
    const l = this.#layout();
    if (leafCount(l) > 1) this.#commit(closeLeaf(l, id));
  }

  // ---- corner gesture ----

  #startCorner(e, leafId, corner) {
    e.preventDefault();
    e.stopPropagation(); // never let a grip start a divider drag as well
    const leafEl = e.currentTarget.parentElement;
    const rect = leafEl.getBoundingClientRect();
    // The union of this pane and the region across its divider, which is what
    // a merge would end up occupying. Null when this is the only pane.
    const splitEl = leafEl.parentElement && leafEl.parentElement.closest('.split');
    const mergeRect = splitEl ? splitEl.getBoundingClientRect() : null;
    const canMerge = !!siblingSubtree(this.#layout(), leafId) && !!mergeRect;

    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.display = 'none';
    this.renderRoot.appendChild(ghost);

    let plan = null;
    const move = (ev) => {
      plan = this.#cornerPlan(rect, mergeRect, canMerge, corner, ev.clientX, ev.clientY);
      if (!plan) { ghost.style.display = 'none'; return; }
      ghost.className = 'ghost' + (plan.kind === 'merge' ? ' merge' : '');
      ghost.style.display = '';
      Object.assign(ghost.style, plan.box);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      ghost.remove();
      if (!plan) return;
      if (plan.kind === 'split') {
        this.#commit(splitLeafAt(this.#layout(), leafId, plan.dir, plan.ratio, plan.before));
      } else {
        this.#commit(absorbSibling(this.#layout(), leafId));
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // Classifies a corner drag and returns the preview box, or null while the
  // pointer is still inside the dead zone. Direction is read from the corner's
  // own edges rather than from the pane centre, so the same gesture means the
  // same thing at every corner: positive is into the pane (split), negative is
  // out of it (merge).
  #cornerPlan(rect, mergeRect, canMerge, corner, x, y) {
    const fromLeft = corner === 'tl' || corner === 'bl';
    const fromTop = corner === 'tl' || corner === 'tr';
    const dx = fromLeft ? x - rect.left : rect.right - x;
    const dy = fromTop ? y - rect.top : rect.bottom - y;
    const T = PandemoniumPanelLayout.GESTURE_THRESHOLD;
    if (Math.abs(dx) < T && Math.abs(dy) < T) return null;

    if (dx < 0 || dy < 0) {
      if (!canMerge) return null;
      return { kind: 'merge', box: boxOf(mergeRect) };
    }

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const dir = horizontal ? 'row' : 'col';
    const ratio = clamp(horizontal ? dx / rect.width : dy / rect.height, 0.12, 0.88);
    const before = horizontal ? fromLeft : fromTop;
    return { kind: 'split', dir, ratio, before, box: splitBox(rect, dir, ratio, before) };
  }

  // ---- divider drag ----

  // Live-resize a split by dragging its border: write flex directly onto the
  // two panes during the drag (no store churn / editor re-render per pixel),
  // commit the ratio on release.
  #startDrag(e, nodeId, axis) {
    e.preventDefault();
    const divider = e.currentTarget;
    const container = divider.parentElement; // .split
    divider.classList.add('dragging');
    const rect = container.getBoundingClientRect();
    const paneA = divider.previousElementSibling;
    const paneB = divider.nextElementSibling;
    const move = (ev) => {
      const f = axis === 'x' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      const val = clamp(f, 0.12, 0.88);
      this._dragVal = val;
      paneA.style.flex = `${val} 1 0`;
      paneB.style.flex = `${1 - val} 1 0`;
    };
    const up = () => {
      this.#endDrag();
      divider.classList.remove('dragging');
      if (this._dragVal != null) this.#commit(setRatio(this.#layout(), nodeId, this._dragVal));
      this._dragVal = null;
    };
    this._dragMove = move; this._dragUp = up;
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  #endDrag() {
    if (this._dragMove) removeEventListener('pointermove', this._dragMove);
    if (this._dragUp) removeEventListener('pointerup', this._dragUp);
    this._dragMove = this._dragUp = null;
  }

  render() {
    if (!this._store.project) return html``;
    return this.#node(this.#layout());
  }
}

function boxOf(rect) {
  return { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' };
}

// The slice of `rect` the NEW pane would take, so the preview shows what you
// are about to create rather than what you are dragging away from.
function splitBox(rect, dir, ratio, before) {
  if (dir === 'row') {
    const w = rect.width * ratio;
    return { left: (before ? rect.left : rect.right - w) + 'px', top: rect.top + 'px', width: w + 'px', height: rect.height + 'px' };
  }
  const h = rect.height * ratio;
  return { left: rect.left + 'px', top: (before ? rect.top : rect.bottom - h) + 'px', width: rect.width + 'px', height: h + 'px' };
}

customElements.define('pandemonium-panel-layout', PandemoniumPanelLayout);

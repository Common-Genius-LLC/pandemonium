'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { dispatch } from '../utils/events.js';
import { clamp } from '../utils/format.js';
import { withGlobalItems } from '../utils/context-menu.js';
import { fadeIn } from '../utils/motion.js';
import {
  defaultLayout, setRatio, setLeafContent, splitLeaf, splitLeafAt, closeLeaf, absorbAcross, growAcross, pathTo,
  PANEL_TYPES, PANEL_LABELS, leafCount,
} from '../data/layout-tree.js';
import '../components/boards/boards-panel.js';
import '../components/research/research-panel.js';
import '../components/editor/script-panel.js';
import './timeline.js';
import './project-status.js';

// Blender-style window division (see data/layout-tree.js). The panels are laid
// out by recursively rendering a binary split tree from project.layout: each
// split is a flex row/column of two panes with a draggable border between them;
// each leaf hosts a panel whose header dropdown switches its content.
//
// The corner gesture generalizes Blender's own two moves beyond the immediate
// pane:
//   - drag a corner grip inward: split this pane. The drag axis picks the
//     direction, the release point picks the ratio, and the corner picks which
//     side the new pane lands on.
//   - drag a corner grip outward: reach across however many ancestor
//     boundaries the drag actually crosses (not just the immediate one) to
//     either split the specific neighboring pane the cursor lands on (using
//     this pane's own content, so it reads as "grew into" the neighbor) or, if
//     the far side is a single pane, absorb it outright.
// Right-clicking a pane offers the same two moves without a drag (a drag-only
// affordance is unreachable from a keyboard), plus switching what the pane
// shows -- see #openLeafMenu.
export class PandemoniumPanelLayout extends LitElement {
  // Below this, a corner drag is a click that happened to wobble.
  static GESTURE_THRESHOLD = 18;
  // How close the pointer needs to be to a specific corner before that
  // corner's handle appears. Comfortably outside GESTURE_THRESHOLD so the
  // handle is visible before a drag would actually commit to anything.
  static CORNER_RADIUS = 56;

  static styles = css`
    /* Even gaps everywhere (Figma node 101-1095): the outer padding equals the
       inter-pane divider width (see .divider), so a pane's gap to the app edge
       matches its gap to a neighbor. */
    /* The corner-tool triangle (Figma node 82-274), as an SVG mask so the fill
       is a theme token, not baked into the asset. Its right angle is at the
       bottom-right of the viewBox; corners rotate it (see .grip rules). */
    :host{
      flex:1;min-height:0;display:flex;padding:6px;background:var(--panel);
      --corner-tool:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8.58779 8.58779'%3E%3Cpath d='M8.58779 1.002V7.58779C8.58779 8.14008 8.14007 8.58779 7.58779 8.58779H1.002C0.111098 8.58779 -0.335066 7.51065 0.294899 6.88068L6.88068 0.294898C7.51065 -0.335067 8.58779 0.1111 8.58779 1.002Z' fill='black'/%3E%3C/svg%3E");
    }
    .split{display:flex;flex:1;min-width:0;min-height:0}
    .split.row{flex-direction:row}
    .split.col{flex-direction:column}
    /* min-width/min-height:0 is what keeps a pane from being pushed wider by
       its content. The shell does its own clipping (styles/shared.js). */
    .pane{display:flex;min-width:0;min-height:0}
    .leaf{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
    pandemonium-boards-panel,pandemonium-research-panel,pandemonium-script-panel,pandemonium-timeline,pandemonium-project-status{
      flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;
    }

    /* The divider IS the gap between two panes; its size equals the outer
       padding so every gap in the layout is identical. The hover bar keeps the
       purple resize tint but no corner rounding, matching the sharp panes. */
    .divider{flex:none;position:relative;z-index:3}
    .divider::after{content:"";position:absolute;background:transparent;border-radius:20px;transition:background .12s}
    .divider.v{width:6px;cursor:col-resize}
    .divider.v::after{inset:0 2px}
    .divider.h{height:6px;cursor:row-resize}
    .divider.h::after{inset:2px 0}
    .divider:hover::after{background:var(--ph)}
    /* The dragging class is set on the one divider the pointer went down on,
       so only the border actually being resized reacts. While resizing the
       whole 6px gap fills with the resize colour (inset:0), rather than the
       thin centered bar the hover state shows. */
    .divider.dragging::after{inset:0;background:var(--res)}

    /* Corner handles: the Figma corner-tool component (node 82-274), a small
       rounded right-triangle that sits in the corner with its right angle in
       the corner and its hypotenuse facing inward. Only the corner nearest the
       pointer is ever shown (see #hoverCorner) -- all four appearing on any
       hover anywhere in the pane was distracting on a page that is mostly text.
       The shape is a token-tinted CSS mask rather than a fixed-fill SVG so it
       themes like everything else (never a hardcoded color, CLAUDE.md): --ui at
       rest, --res on hover -- the same pink the Figma active variant uses. */
    .grip{position:absolute;width:20px;height:20px;z-index:9;opacity:0;transition:opacity .12s}
    .grip.near{opacity:1}
    .grip::after{
      content:"";position:absolute;width:11px;height:11px;background:var(--ui);
      -webkit-mask:var(--corner-tool) center/contain no-repeat;
      mask:var(--corner-tool) center/contain no-repeat;
      transition:background .12s;
    }
    .grip:hover::after{background:var(--res)}
    /* The base shape points its right angle bottom-right; each corner rotates
       it so the right angle lands in that corner, and anchors the 11px shape to
       the same corner the grip occupies. */
    .grip.tl{top:0;left:0;cursor:nwse-resize}
    .grip.tl::after{top:0;left:0;transform:rotate(180deg)}
    .grip.tr{top:0;right:0;cursor:nesw-resize}
    .grip.tr::after{top:0;right:0;transform:rotate(270deg)}
    .grip.bl{bottom:0;left:0;cursor:nesw-resize}
    .grip.bl::after{bottom:0;left:0;transform:rotate(90deg)}
    .grip.br{bottom:0;right:0;cursor:nwse-resize}
    .grip.br::after{bottom:0;right:0;transform:rotate(0)}

    /* Live gesture preview. Positioned in viewport coordinates and painted
       over everything, so nothing in the tree has to re-render per pointer
       move: the same discipline the divider drag already follows. It is the
       app pink (--res) for every move -- splitting from inside, growing into a
       neighbor, or merging -- so the preview always reads as "this is the area
       you are about to get"; a merge (which swallows a whole neighbor) is drawn
       fainter so the larger, more destructive reach still looks different. */
    .ghost{position:fixed;z-index:40;pointer-events:none;border-radius:20px;background:var(--res);opacity:.34}
    .ghost.merge{opacity:.2}

    @media (max-width:1100px){
      :host{display:block;overflow:auto;padding:14px}
      .split,.split.row,.split.col{display:flex;flex-direction:column}
      .pane{flex:none!important;min-height:300px}
      .divider{display:none}
      /* A stacked layout has no dividers to drag a corner across, so the
         gesture has nothing to mean here. */
      .grip{display:none}
    }
    @media (max-width:700px){
      :host{padding:10px}
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
      <div class="split ${isRow ? 'row' : 'col'}" data-split=${node.id}>
        <div class="pane" style="flex:${node.ratio} 1 0">${this.#node(node.a)}</div>
        <div class="divider ${isRow ? 'v' : 'h'}" @pointerdown=${(e) => this.#startDrag(e, node.id, isRow ? 'x' : 'y')}></div>
        <div class="pane" style="flex:${1 - node.ratio} 1 0">${this.#node(node.b)}</div>
      </div>`;
  }

  #leaf(node) {
    return html`
      <div class="leaf" data-leaf=${node.id}
        @contextmenu=${(e) => this.#openLeafMenu(e, node)}
        @pointermove=${(e) => this.#hoverCorner(e)}
        @pointerleave=${(e) => this.#hoverLeave(e)}
      >
        ${this.#panelFor(node)}
        ${['tl', 'tr', 'bl', 'br'].map((c) => html`
          <div class="grip ${c}" title="Drag inward to split this pane. Drag outward to extend into a neighboring pane, or merge with it."
            @pointerdown=${(e) => this.#startCorner(e, node.id, c)}></div>`)}
      </div>`;
  }

  #panelFor(node) {
    if (node.content === 'boards') return html`<pandemonium-boards-panel .leafId=${node.id}></pandemonium-boards-panel>`;
    if (node.content === 'research') return html`<pandemonium-research-panel .leafId=${node.id}></pandemonium-research-panel>`;
    if (node.content === 'timeline') return html`<pandemonium-timeline .leafId=${node.id}></pandemonium-timeline>`;
    if (node.content === 'status') return html`<pandemonium-project-status .leafId=${node.id}></pandemonium-project-status>`;
    return html`<pandemonium-script-panel .leafId=${node.id}></pandemonium-script-panel>`;
  }

  #split(id, dir) { this.#commit(splitLeaf(this.#layout(), id, dir)); }

  #close(id) {
    const l = this.#layout();
    if (leafCount(l) > 1) this.#commit(closeLeaf(l, id));
  }

  // The pane's right-click menu: this is also the non-drag, keyboard-reachable
  // path to everything the corner gesture and the old hover buttons offered.
  #openLeafMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();
    const layout = this.#layout();
    const items = [
      ...this.#draftMenuItems(node),
      ...PANEL_TYPES.map((t) => ({
        label: PANEL_LABELS[t],
        selected: t === node.content,
        fn: () => this.#commit(setLeafContent(layout, node.id, t)),
      })),
      { divider: true },
      { label: 'Split left / right', fn: () => this.#split(node.id, 'row') },
      { label: 'Split top / bottom', fn: () => this.#split(node.id, 'col') },
      ...(leafCount(layout) > 1 ? [{ label: 'Close pane', danger: true, fn: () => this.#close(node.id) }] : []),
    ];
    dispatch(this, 'pandemonium-open-menu', { x: e.clientX, y: e.clientY, items: withGlobalItems(this, items) });
  }

  // Draft actions for a script pane showing a non-final draft, prepended to the
  // top of that pane's context menu. This replaces the old in-panel banner
  // ("Boards & sources attach to the final draft"): the same two actions, now
  // where a user reaches for pane actions, instead of a persistent strip.
  #draftMenuItems(node) {
    const store = this._store.store;
    if (node.content !== 'script' || !store.project) return [];
    const sc = store.scriptForLeaf(node.id);
    if (!sc || sc.final) return [];
    const finalSc = store.finalScript();
    return [
      { label: 'Make this the final draft', fn: () => store.makeFinal(sc.id) },
      { label: `View final draft (${finalSc.name})`, fn: () => store.setPaneDraft(node.id, finalSc.id) },
      { divider: true },
    ];
  }

  // ---- corner hover (which single handle is visible) ----

  // Reveals only the corner nearest the pointer, within CORNER_RADIUS, instead
  // of all four on any hover. Runs on plain pointermove and writes directly to
  // the grip elements' classList rather than through Lit state, matching the
  // no-reactive-churn-mid-gesture discipline the drags below already follow.
  #hoverCorner(e) {
    const leafEl = e.currentTarget;
    const rect = leafEl.getBoundingClientRect();
    const corners = {
      tl: [rect.left, rect.top], tr: [rect.right, rect.top],
      bl: [rect.left, rect.bottom], br: [rect.right, rect.bottom],
    };
    let nearest = null, best = Infinity;
    for (const [c, [cx, cy]] of Object.entries(corners)) {
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < best) { best = d; nearest = c; }
    }
    const within = best <= PandemoniumPanelLayout.CORNER_RADIUS;
    leafEl.querySelectorAll('.grip').forEach((g) => g.classList.toggle('near', within && g.classList.contains(nearest)));
  }

  #hoverLeave(e) {
    e.currentTarget.querySelectorAll('.grip').forEach((g) => g.classList.remove('near'));
  }

  // ---- corner gesture ----

  #startCorner(e, leafId, corner) {
    e.preventDefault();
    e.stopPropagation(); // never let a grip start a divider drag as well

    // One rect snapshot per node for the whole drag -- the tree cannot change
    // until pointerup, so there is no need to re-measure on every move.
    const leafRects = new Map();
    this.renderRoot.querySelectorAll('[data-leaf]').forEach((el) => leafRects.set(el.dataset.leaf, el.getBoundingClientRect()));
    const splitRects = new Map();
    this.renderRoot.querySelectorAll('[data-split]').forEach((el) => splitRects.set(el.dataset.split, el.getBoundingClientRect()));
    const rectOf = (n) => (n.type === 'leaf' ? leafRects : splitRects).get(n.id);

    // The root-to-leaf path, with each ancestor's side-toward-this-leaf
    // precomputed, so the outward scan below can walk from the outermost
    // boundary in rather than repeatedly searching the tree.
    const path = pathTo(this.#layout(), leafId);
    const ancestors = path.slice(0, -1).map((node, i) => ({ node, aSide: node.a === path[i + 1] ? 'a' : 'b' }));
    const ctx = { rect: leafRects.get(leafId), ancestors, rectOf, leafId, content: path[path.length - 1].content };

    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.display = 'none';
    this.renderRoot.appendChild(ghost);

    let plan = null;
    const move = (ev) => {
      plan = this.#cornerPlan(ctx, corner, ev.clientX, ev.clientY);
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
      if (plan.kind === 'merge') {
        this.#commit(absorbAcross(this.#layout(), plan.ancestorId, plan.keepSide));
      } else if (plan.kind === 'grow') {
        this.#commit(growAcross(this.#layout(), leafId, plan.ancestorId, plan.bandDir, plan.before, plan.frac));
      } else {
        const content = plan.target === leafId ? null : ctx.content;
        this.#commit(splitLeafAt(this.#layout(), plan.target, plan.dir, plan.ratio, plan.before, content));
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // Classifies a corner drag on every pointer move. Inward is always a
  // self-split (unchanged in effect from before, just re-expressed through
  // penetration()). Outward walks the dragged leaf's ancestor chain to find
  // whichever boundary the cursor has actually crossed, which may be several
  // levels up rather than just the immediate parent -- see outwardPlan.
  #cornerPlan(ctx, corner, x, y) {
    const { rect } = ctx;
    const fromLeft = corner === 'tl' || corner === 'bl';
    const fromTop = corner === 'tl' || corner === 'tr';
    const dx = fromLeft ? x - rect.left : rect.right - x;
    const dy = fromTop ? y - rect.top : rect.bottom - y;
    const T = PandemoniumPanelLayout.GESTURE_THRESHOLD;
    if (Math.abs(dx) < T && Math.abs(dy) < T) return null;

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if ((horizontal ? dx : dy) >= 0) {
      const dir = horizontal ? 'row' : 'col';
      const before = horizontal ? fromLeft : fromTop;
      const ratio = clamp(penetration(rect, dir, before, x, y), 0.12, 0.88);
      return { kind: 'split', target: ctx.leafId, dir, ratio, before, box: splitBox(rect, dir, ratio, before) };
    }

    const sign = (axis) => (axis === 'row' ? (fromLeft ? -1 : 1) : (fromTop ? -1 : 1));
    const primaryAxis = horizontal ? 'row' : 'col';
    const secondaryAxis = horizontal ? 'col' : 'row';
    const secondaryOutward = horizontal ? dy < 0 : dx < 0;
    return outwardPlan(ctx, primaryAxis, sign(primaryAxis), x, y)
      || (secondaryOutward ? outwardPlan(ctx, secondaryAxis, sign(secondaryAxis), x, y) : null);
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

  // A pane whose panel type just changed fades its new panel in, so switching
  // Script to Storyboards reads as the pane turning over rather than
  // blinking. Only a change of type counts: a re-render of the same panel, a
  // resize, or a split does not animate anything that did not change.
  #contentByLeaf = new Map();

  updated() {
    const seen = new Map();
    for (const leafEl of this.renderRoot.querySelectorAll('.leaf[data-leaf]')) {
      const id = leafEl.getAttribute('data-leaf');
      const panel = leafEl.firstElementChild;
      const type = panel ? panel.tagName : '';
      seen.set(id, type);
      const before = this.#contentByLeaf.get(id);
      if (before && before !== type) fadeIn(panel, { rise: 0, from: 0 });
    }
    this.#contentByLeaf = seen;
  }

  render() {
    if (!this._store.project) return html``;
    const layout = this.#layout();
    // Focused writing mode: show only the focused leaf, without touching the
    // saved split tree. If the leaf no longer exists (pane was closed while
    // focused), fall through to the normal full-tree render.
    const focusedId = this._store.ui && this._store.ui.focusedLeaf;
    if (focusedId) {
      const path = pathTo(layout, focusedId);
      const leafNode = path && path[path.length - 1];
      if (leafNode) return this.#leaf(leafNode);
    }
    return this.#node(layout);
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

function pointInRect(x, y, r) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

// How far into `rect` (x,y) has penetrated along `axis` from the edge `before`
// designates, as a 0..1 fraction. Shared by self-split and neighbor-split so
// both express the same "how far did you drag into this rect" arithmetic once.
function penetration(rect, axis, before, x, y) {
  return axis === 'row'
    ? (before ? (x - rect.left) / rect.width : (rect.right - x) / rect.width)
    : (before ? (y - rect.top) / rect.height : (rect.bottom - y) / rect.height);
}

// Descends from `node` (the far side of a crossed boundary) to whichever leaf
// sits directly against that boundary, so a neighbor-split always lands on the
// pane actually touching the divider that was crossed, never a leaf further
// into the cluster. Nested splits along the same axis resolve toward the
// entry edge deterministically; a nested split across the other axis needs the
// cursor's cross-axis position to say which of the two stacked panes it is over.
function nearestLeaf(node, axis, dirSign, crossCoord, rectOf) {
  if (node.type === 'leaf') return node;
  if (node.dir === axis) return nearestLeaf(dirSign > 0 ? node.a : node.b, axis, dirSign, crossCoord, rectOf);
  const a = rectOf(node.a), b = rectOf(node.b);
  const mid = node.dir === 'row' ? (a.right + b.left) / 2 : (a.bottom + b.top) / 2;
  return nearestLeaf(crossCoord < mid ? node.a : node.b, axis, dirSign, crossCoord, rectOf);
}

// The far side of the crossed boundary is a single pane. Two outcomes,
// decided by whether the dragged pane already spans the ancestor across the
// band axis (the axis perpendicular to the drag):
//   - It spans (it is as tall as the ancestor for a sideways drag): a plain
//     absorb, the dragged pane fills the whole ancestor and the neighbor is
//     swallowed. Ghost is the whole ancestor.
//   - It is shorter: grow into a band instead of swallowing. The dragged pane
//     becomes a strip across the ancestor at its own current size and position
//     (a full-width row along the bottom when you drag the bottom-left pane
//     right), and the neighbor keeps the rest. Ghost is just that strip, not
//     the whole window.
function singlePlan(ctx, anc, aSide, axis) {
  const ancRect = ctx.rectOf(anc);
  const rect = ctx.rect;
  const bandDir = axis === 'row' ? 'col' : 'row';
  const frac = axis === 'row' ? rect.height / ancRect.height : rect.width / ancRect.width;
  const before = axis === 'row'
    ? (rect.top + rect.bottom) / 2 < (ancRect.top + ancRect.bottom) / 2
    : (rect.left + rect.right) / 2 < (ancRect.left + ancRect.right) / 2;
  if (frac >= 0.98) return { kind: 'merge', ancestorId: anc.id, keepSide: aSide, box: boxOf(ancRect) };
  return { kind: 'grow', ancestorId: anc.id, bandDir, before, frac, box: splitBox(ancRect, bandDir, frac, before) };
}

// Walks the dragged leaf's ancestor chain outermost-first looking for the
// farthest boundary, in this axis/direction, that the cursor has actually
// crossed. Crossing is monotonic (any outer boundary being crossed implies
// every nearer same-axis, same-direction boundary already was), so the first
// match scanning outermost-first is the farthest the pointer has reached.
// Only ancestors whose split direction matches `axis`, and whose non-dragged
// side lies in the direction of travel, are candidates.
function outwardPlan(ctx, axis, dirSign, x, y) {
  const wantSide = dirSign > 0 ? 'a' : 'b';
  for (const { node: anc, aSide } of ctx.ancestors) {
    if (anc.dir !== axis || aSide !== wantSide) continue;
    const other = aSide === 'a' ? anc.b : anc.a;
    const otherRect = ctx.rectOf(other);
    if (!otherRect) continue;
    const crossed = axis === 'row'
      ? (dirSign > 0 ? x > otherRect.left : x < otherRect.right)
      : (dirSign > 0 ? y > otherRect.top : y < otherRect.bottom);
    if (!crossed) continue;

    if (other.type === 'leaf') return singlePlan(ctx, anc, aSide, axis);

    const near = nearestLeaf(other, axis, dirSign, axis === 'row' ? y : x, ctx.rectOf);
    const nearRect = near && ctx.rectOf(near);
    if (nearRect && pointInRect(x, y, nearRect)) {
      const before = dirSign > 0;
      const ratio = clamp(penetration(nearRect, axis, before, x, y), 0.12, 0.88);
      return { kind: 'split', target: near.id, dir: axis, ratio, before, box: splitBox(nearRect, axis, ratio, before) };
    }
    // Overshot the near neighbor entirely: fall back to absorbing the whole
    // reached cluster rather than trying to reach even further in.
    return { kind: 'merge', ancestorId: anc.id, keepSide: aSide, box: boxOf(ctx.rectOf(anc)) };
  }
  return null;
}

customElements.define('pandemonium-panel-layout', PandemoniumPanelLayout);

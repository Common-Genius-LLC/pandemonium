'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../state/store-controller.js';
import { clamp } from '../utils/format.js';
import { defaultLayout, setRatio, splitLeaf, closeLeaf, leafCount } from '../data/layout-tree.js';
import '../components/boards/boards-panel.js';
import '../components/research/research-panel.js';
import '../components/editor/script-panel.js';

// Blender-style window division (see data/layout-tree.js). The panels are laid
// out by recursively rendering a binary split tree from ui.layout: each split
// is a flex row/column of two panes with a draggable border between them; each
// leaf hosts a panel whose header dropdown switches its content, plus hover
// controls to split it left/right or top/bottom, or close it. This replaces the
// old everything/split/single view modes entirely.
export class PandemoniumPanelLayout extends LitElement {
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
    pandemonium-boards-panel,pandemonium-research-panel,pandemonium-script-panel{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}

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

    .regionctl{position:absolute;bottom:8px;right:8px;z-index:9;display:flex;gap:2px;opacity:0;transition:opacity .12s;pointer-events:none}
    .leaf:hover .regionctl{opacity:1;pointer-events:auto}
    .regionctl button{
      width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;
      color:var(--ui);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans);
    }
    .regionctl button:hover{background:var(--ph)}
    .regionctl button.close:hover{background:var(--danger);color:#fff}

    @media (max-width:900px){
      :host{display:block;overflow:auto;padding:0 14px 14px}
      .split,.split.row,.split.col{display:flex;flex-direction:column}
      .pane{flex:none!important;min-height:320px}
      .divider{display:none}
    }
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  disconnectedCallback() { this.#endDrag(); super.disconnectedCallback(); }

  #layout() { return this._store.ui.layout || defaultLayout(); }

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
    return html`<pandemonium-script-panel .leafId=${node.id}></pandemonium-script-panel>`;
  }

  #split(id, dir) { this._store.store.setUI({ layout: splitLeaf(this.#layout(), id, dir) }); }

  #close(id) {
    const l = this.#layout();
    if (leafCount(l) > 1) this._store.store.setUI({ layout: closeLeaf(l, id) });
  }

  // Live-resize a split by dragging its border: write flex directly onto the
  // two panes during the drag (no store churn / editor re-render per pixel),
  // commit the ratio to ui on release.
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
      if (this._dragVal != null) this._store.store.setUI({ layout: setRatio(this.#layout(), nodeId, this._dragVal) });
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
    const ui = this._store.ui;
    if (!ui) return html``;
    return this.#node(this.#layout());
  }
}

customElements.define('pandemonium-panel-layout', PandemoniumPanelLayout);

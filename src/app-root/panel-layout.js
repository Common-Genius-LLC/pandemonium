'use strict';

import { LitElement, html, css } from 'lit';
import '../components/boards/boards-panel.js';
import '../components/research/research-panel.js';

// Phase 1: hosts the script panel inline (its own file lands in Phase 3
// when the Preview/Edit split is replaced by the unified CodeMirror editor).
import '../components/editor/script-panel.js';

// Grid layout for the three panels, ported from the original
// #main.v-everything / v-split / v-single rules. `view`/`split` are
// reflected attributes so the CSS can select on them directly.
export class PandemoniumPanelLayout extends LitElement {
  static properties = {
    view: { type: String, reflect: true }, // 'everything' | 'split' | 'single'
    split: { type: String, reflect: true }, // 'boards' | 'research'
  };

  static styles = css`
    :host{flex:1;min-height:0;display:grid;padding:0 22px 18px;gap:24px}
    pandemonium-boards-panel,pandemonium-research-panel,pandemonium-script-panel{
      display:flex;flex-direction:column;min-height:0;min-width:0;
    }
    :host([view=everything]){
      grid-template-columns:5fr 7fr;grid-template-rows:1fr 236px;
      grid-template-areas:"boards script" "research research";
    }
    :host([view=everything]) pandemonium-boards-panel{grid-area:boards}
    :host([view=everything]) pandemonium-script-panel{grid-area:script}
    :host([view=everything]) pandemonium-research-panel{grid-area:research}

    :host([view=split]){grid-template-columns:1fr 1fr;grid-template-areas:"side script"}
    :host([view=split]) pandemonium-script-panel{grid-area:script}
    :host([view=split][split=boards]) pandemonium-boards-panel{grid-area:side}
    :host([view=split][split=boards]) pandemonium-research-panel{display:none}
    :host([view=split][split=research]) pandemonium-research-panel{grid-area:side}
    :host([view=split][split=research]) pandemonium-boards-panel{display:none}

    :host([view=single]){grid-template-columns:1fr;grid-template-areas:"script"}
    :host([view=single]) pandemonium-script-panel{grid-area:script}
    :host([view=single]) pandemonium-boards-panel,
    :host([view=single]) pandemonium-research-panel{display:none}

    @media (max-width:900px){
      :host([view=everything]),:host([view=split]){
        grid-template-columns:1fr;grid-template-rows:auto;
        grid-template-areas:"script" "boards" "research";
        display:flex;flex-direction:column;overflow:auto;
      }
      pandemonium-boards-panel,pandemonium-research-panel{min-height:280px;flex:none}
      pandemonium-script-panel{min-height:60vh}
    }
  `;

  render() {
    return html`
      <pandemonium-boards-panel></pandemonium-boards-panel>
      <pandemonium-script-panel></pandemonium-script-panel>
      <pandemonium-research-panel></pandemonium-research-panel>
    `;
  }
}

customElements.define('pandemonium-panel-layout', PandemoniumPanelLayout);

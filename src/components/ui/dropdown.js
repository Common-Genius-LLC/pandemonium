'use strict';

import { css, svg } from 'lit';

// Figma "panel-dropdown" (node 31:188), shared by every menu-opening control
// that is not a button: the pane-title picker and the script panel's element
// picker. Property 1=Default is bare text on no fill; Property 1=Variant2
// (open) adds the #eaeaea fill and the caret.
//
// Two deliberate changes from the component. Height is 24px rather than its
// 19px so a dropdown lines up with the buttons sitting beside it in the same
// header. And the caret always occupies its 7px, with only its visibility
// flipping, because revealing it on hover would change the control's width
// and shove the rest of the header sideways on every mouseover.
//
// The frame's asymmetric 2px/5px vertical padding comes from how Figma
// measures a text node, not from the design intending the label to sit high
// in the fill. Centering both the label and the caret is what it draws.
//
// Not a component of its own: these controls each own their menu contents and
// anchor behavior, and only need to agree on how they look.
export const dropdownStyles = css`
  .pd-dropdown{
    box-sizing:border-box;
    height:24px;
    display:inline-flex;align-items:center;justify-content:center;gap:4px;
    padding:0 7px 0 9px;
    font-family:var(--sans);font-size:12px;font-weight:500;line-height:1;
    letter-spacing:-0.12px;color:var(--ink);
    background:rgba(255,255,255,0);
    border:0;border-radius:var(--r);cursor:pointer;white-space:nowrap;
  }
  /* :focus stands in for "menu is open": clicking moves focus to the control,
     and the menu closes on the next click elsewhere, which also blurs it. */
  .pd-dropdown:hover,.pd-dropdown:focus{background:var(--menu-bg)}
  /* The fill is the open-state feedback, so a click does not also need a
     focus ring. Keyboard focus still gets one. */
  .pd-dropdown:focus{outline:none}
  .pd-dropdown:focus-visible{outline:2px solid var(--link);outline-offset:1px}
  .pd-caret{width:7px;height:10px;flex:none;display:block;visibility:hidden}
  .pd-dropdown:hover .pd-caret,.pd-dropdown:focus .pd-caret{visibility:visible}
`;

export const dropdownCaret = svg`<svg class="pd-caret" viewBox="0 0 7 10" fill="none" aria-hidden="true">
  <path d="M3.22414 8.73727L0 5.66667L0.7 5.00009L3.49994 7.66667L6.3 5.00009L7 5.66667L3.77586 8.73727C3.62138 8.8844 3.37862 8.8844 3.22414 8.73727Z" fill="black" fill-opacity="0.5"/>
</svg>`;

// Shared Lit `css` fragments for form fields and chips. Shadow DOM does not
// inherit ordinary CSS rules (only custom properties do), so a single
// global stylesheet can't style form controls inside every component's
// shadow root -- instead every component that renders a labeled field or a
// contributor chip imports and spreads these into its own `static styles`.
// Keep this file as the one place those rules are defined.
'use strict';

import { css } from 'lit';

// Fields wear the Button-Standard shell (white fill, #b8b8b8 border, 3px
// radius) so a form reads as the same kit as the buttons under it, instead of
// the uppercase-label-on-grey-well look the app carried over from before the
// Figma components existed.
export const formStyles = css`
  .lbl{font-size:11px;font-weight:500;color:var(--mut)}
  .field{display:block;min-width:0}
  .field label{display:block;margin-bottom:5px}
  input,textarea,select{
    font:inherit;font-size:12px;color:var(--ink);
    background:var(--field);border:1px solid var(--btn-line);border-radius:var(--r);
    outline:none;font-family:var(--sans);box-sizing:border-box;
  }
  input::placeholder,textarea::placeholder{color:var(--mut)}
  input:focus-visible,textarea:focus-visible,select:focus-visible{border-color:var(--link)}
  input[type=text],input[type=url],input[type=number],select{width:100%;height:24px;padding:0 8px}
  textarea{width:100%;min-height:110px;padding:8px;resize:vertical;line-height:1.6}
  /* Grid, not flex: equal columns that hold even when one field's content is
     wider than the other's, which is what collapsed the gap here before. */
  .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`;

// Shared by every panel (boards/script/research). Figma "Final Draft" /
// "Other Drafts" (nodes 44:148, 44:157): the panel is a rounded #f0f0f0 shell
// with a 30px chrome strip along the top, and the working area fills the rest.
// The title dropdown and the panel's own buttons live INSIDE that strip, so a
// pane is one object on the page rather than a floating header above a box.
//
// `--pane-bg` is the working area's colour, set per panel.
export const panelStyles = css`
  :host{display:flex;flex-direction:column;min-height:0;min-width:0}
  /* No shadow, flat solid fills (Figma node 101-1095): panes are set apart by
     even gaps rather than elevation. Rounded the same amount as the app's
     pill buttons (20px, e.g. board-card.js .pill, the Final/Reference mode
     toggle), not the subtler --r used for small controls, so a pane reads as
     the same family of shape as the rounded chrome sitting on top of it. */
  .shell{
    flex:1;min-height:0;display:flex;flex-direction:column;
    background:var(--pane-bg,var(--bg));border-radius:20px;overflow:hidden;
  }
  /* The strip takes the pane's own colour, so a panel is one solid object. */
  .chrome{
    flex:none;height:30px;display:flex;align-items:stretch;
    background:var(--pane-bg,var(--bg));
    padding:6px 8px;gap:0;
  }
  .chrome pd-panel-picker{align-self:center}
  .chrome .sub{align-self:center;color:var(--mut);font-size:11px;margin-left:6px}
  .chrome .tools{margin-left:auto;align-self:center;display:flex;align-items:center;gap:4px}
  .pbody{
    flex:1;min-height:0;overflow:auto;background:var(--pane-bg,var(--bg));
    scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
  }
  .pbody::-webkit-scrollbar{width:8px;height:8px}
  .pbody::-webkit-scrollbar-thumb{background:var(--ph);border-radius:4px}
  .pbody::-webkit-scrollbar-track{background:transparent}
  .mode{display:flex;gap:2px}
  .mode button{height:20px;padding:0 8px;font-size:10px;font-weight:500;color:var(--mut);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
  .mode button.on{background:var(--overlay);color:var(--overlay-ink)}
  .empty{color:var(--mut);padding:18px 14px;line-height:1.7;max-width:340px}
  @media (max-width:900px){
    .chrome{
      height:auto;
      min-height:30px;
      flex-wrap:wrap;
      row-gap:4px;
      padding:4px 6px;
    }
    .chrome .sub{margin-left:0}
    .chrome .tools{
      margin-left:0;
      padding-right:0;
      flex-wrap:wrap;
      justify-content:flex-start;
    }
    .mode{flex-wrap:wrap}
  }
`;

// The draft tabs in the script panel's chrome strip: pills in a pill track,
// the same object as the Final / Reference switch in the boards panel. The old
// tabs were file-folder tabs cut out of a grey strip, which stopped making
// sense once every pane became one white surface (and read as low contrast
// grey on grey). The active pill's dark fill is NOT drawn here: the panel
// draws one filled pill behind the row and slides it to whichever draft is
// active (script-panel.js .thumb), so switching drafts is one visible motion
// rather than one pill blinking off and another on.
//
// The final draft carries weight (Medium against the others' Regular), which
// is what marks it as the draft that owns the links.
export const tabStyles = css`
  .tab{
    position:relative;z-index:1;box-sizing:border-box;flex:none;
    height:24px;max-width:150px;padding:0 12px;border:0;border-radius:20px;
    font-family:var(--sans);font-size:12px;line-height:24px;letter-spacing:-0.12px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    color:var(--ui);background:transparent;cursor:pointer;
    transition:color var(--dur-2) var(--ease-out),background var(--dur-1) var(--ease-out);
  }
  .tab:hover{color:var(--ink);background:var(--row-hover)}
  .tab.final{font-weight:500}
  .tab.on,.tab.on:hover{color:var(--overlay-ink);background:transparent}
`;

export const chipStyles = css`
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .chip{
    height:16px;padding:0 7px;font-size:10px;font-weight:500;color:var(--ink);
    display:inline-flex;align-items:center;gap:5px;border-radius:2px;
  }
  .chip b{font-weight:500}
  .chip .x{cursor:pointer;opacity:.55;font-family:var(--sans)}
  .chip .x:hover{opacity:1}
`;

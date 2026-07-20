// Shared Lit `css` fragments for form fields and chips. Shadow DOM does not
// inherit ordinary CSS rules (only custom properties do), so a single
// global stylesheet can't style form controls inside every component's
// shadow root -- instead every component that renders a labeled field or a
// contributor chip imports and spreads these into its own `static styles`.
// Keep this file as the one place those rules are defined.
'use strict';

import { css } from 'lit';

export const formStyles = css`
  .lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .field{display:block}
  .field label{display:block;margin-bottom:4px}
  input,textarea,select{
    font:inherit;color:var(--ink);background:var(--panel);border-radius:var(--r);
    outline:none;border:0;font-family:var(--sans);
  }
  input::placeholder,textarea::placeholder{color:var(--mut)}
  input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--link);outline-offset:1px}
  input[type=text],input[type=url],input[type=number],select{width:100%;height:28px;padding:0 10px}
  textarea{width:100%;min-height:110px;padding:8px 10px;resize:vertical;line-height:1.6}
  .row{display:flex;gap:10px}
  .row>div{flex:1}
`;

// Shared by every panel (boards/script/research): header row, scrollable
// body with a thin scrollbar, and the small dark segmented mode switch.
export const panelStyles = css`
  :host{display:flex;flex-direction:column;min-height:0;min-width:0}
  .phead{flex:none;display:flex;align-items:center;gap:10px;padding-bottom:8px}
  .phead .lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .phead .sub{color:var(--mut);font-size:11px;text-transform:none;letter-spacing:0}
  .phead .tools{margin-left:auto;display:flex;align-items:center;gap:4px}
  .pbody{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--ph) transparent}
  .pbody::-webkit-scrollbar{width:8px;height:8px}
  .pbody::-webkit-scrollbar-thumb{background:var(--ph);border-radius:4px}
  .pbody::-webkit-scrollbar-track{background:transparent}
  .mode{display:flex;gap:2px}
  .mode button{height:20px;padding:0 8px;font-size:10px;font-weight:500;color:var(--mut);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;font-family:var(--sans)}
  .mode button.on{background:var(--ui);color:#fff}
  .empty{color:var(--mut);padding:18px 4px;line-height:1.7;max-width:340px}
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

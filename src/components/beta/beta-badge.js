'use strict';

import { LitElement, html, css } from 'lit';
import { BUILD_VERSION } from '../../config/beta.js';
import { bugReporter } from '../../utils/bug-report.js';
import { dispatch } from '../../utils/events.js';

// The one piece of beta chrome: a small marker in the bottom-right that also
// happens to be the way a tester reports a bug. Bottom-right because the toast
// and the linkbar both sit bottom-center, and the topbar is already full.
//
// It carries a dot once anything has been logged to the console or thrown, so
// a tester who did not notice a failure still gets nudged toward reporting it.
// That is the whole reason the badge is a button rather than a label.
export class PdBetaBadge extends LitElement {
  static properties = { _errors: { state: true } };

  static styles = css`
    :host{
      position:fixed;right:10px;bottom:10px;z-index:70;
      font-family:var(--sans);
    }
    button{
      display:inline-flex;align-items:center;gap:6px;
      height:22px;padding:0 9px;
      font-family:var(--sans);font-size:10px;font-weight:500;letter-spacing:.04em;
      text-transform:uppercase;
      color:var(--overlay-ink);background:var(--overlay);
      border:0;border-radius:var(--r);
      box-shadow:0 1px 3px rgba(0,0,0,.28);
      cursor:pointer;opacity:.72;
    }
    button:hover{opacity:1}
    button:active{box-shadow:inset 0 1px 4px rgba(0,0,0,.5)}
    .v{opacity:.6;text-transform:none;letter-spacing:0}
    /* Muted rather than the full --danger: this is an invitation to report,
       not an error state the tester has to resolve. */
    .dot{
      width:5px;height:5px;border-radius:50%;
      background:var(--act);flex:none;
    }
  `;

  constructor() {
    super();
    this._errors = 0;
    this._onChange = () => { this._errors = bugReporter.errorCount; };
  }

  connectedCallback() {
    super.connectedCallback();
    bugReporter.addEventListener('change', this._onChange);
    this._errors = bugReporter.errorCount;
  }

  disconnectedCallback() {
    bugReporter.removeEventListener('change', this._onChange);
    super.disconnectedCallback();
  }

  render() {
    return html`
      <button
        title=${this._errors
          ? `Beta ${BUILD_VERSION}. ${this._errors} issue${this._errors === 1 ? '' : 's'} logged. Click to report.`
          : `Beta ${BUILD_VERSION}. Click to report a bug.`}
        @click=${() => dispatch(this, 'pandemonium-open-bug-report', {})}
      >
        ${this._errors ? html`<span class="dot"></span>` : ''}
        Beta
        <span class="v">${BUILD_VERSION}</span>
      </button>
    `;
  }
}

customElements.define('pd-beta-badge', PdBetaBadge);

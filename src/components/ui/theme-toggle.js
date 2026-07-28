'use strict';

import { LitElement, html, css } from 'lit';
import { theme } from '../../state/theme.js';

// The light/dark switch in the title bar. Styled as chrome (transparent, white
// glyph) rather than as a pd-button, because it sits on the title bar gradient
// next to the project name, not in the actions group with New/Save/Open.
//
// Holds no state of its own: state/theme.js owns the preference and this
// re-renders off its change event, so the glyph can never disagree with the
// page, including when the desktop flips theme underneath a 'system'
// preference at sunset.
export class PdThemeToggle extends LitElement {
  static styles = css`
    :host{display:inline-flex}
    button{
      width:26px;height:26px;display:flex;align-items:center;justify-content:center;
      background:none;border:0;border-radius:var(--r);cursor:pointer;padding:0;
      color:rgba(255,255,255,.88);font-family:var(--sans);
    }
    button:hover{background:rgba(255,255,255,.28)}
    svg{width:15px;height:15px;display:block;fill:currentColor}
  `;

  constructor() {
    super();
    this._onTheme = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    theme.addEventListener('change', this._onTheme);
  }

  disconnectedCallback() {
    theme.removeEventListener('change', this._onTheme);
    super.disconnectedCallback();
  }

  render() {
    const dark = theme.resolved === 'dark';
    // The glyph shows what you will GET, not what you are in: a moon on the
    // light theme reads as "go dark". Labelling it the other way round is the
    // classic coin-flip that makes people click twice to find out.
    return html`
      <button
        title=${dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
        aria-label=${dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
        @click=${() => theme.toggle()}
      >
        ${dark
          ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-13a1 1 0 0 1-1-1V2a1 1 0 0 1 2 0v1a1 1 0 0 1-1 1zm0 18a1 1 0 0 1-1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1-1 1zm10-9h-1a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zM3 12H2a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zm15.07-6.07a1 1 0 0 1-.7-1.71l.7-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-.71.3zM5.64 19.36a1 1 0 0 1-.71-1.71l.71-.7a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-.71.29zm12.73 0a1 1 0 0 1-.71-.29l-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1-.71 1.71zM5.64 5.93a1 1 0 0 1-.71-.29l-.7-.71a1 1 0 0 1 1.41-1.42l.71.71a1 1 0 0 1-.71 1.71z"/></svg>`
          : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.3 22a10 10 0 0 1-1.4-19.9 1 1 0 0 1 1 1.6A7.9 7.9 0 0 0 10.6 14a7.9 7.9 0 0 0 9.4 1.3 1 1 0 0 1 1.4 1.2A10 10 0 0 1 12.3 22z"/></svg>`}
      </button>
    `;
  }
}

customElements.define('pd-theme-toggle', PdThemeToggle);

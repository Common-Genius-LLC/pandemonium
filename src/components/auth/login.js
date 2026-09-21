'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { session } from '../../data/session.js';
import { dispatch } from '../../utils/events.js';
import '../ui/logo.js';
import '../ui/button.js';
import '../ui/segmented.js';

// The sign-in page: the screen is split down the middle, the form on the left
// and, on the right, room for a picture.
//
// The picture is not in the code. Put an image at src/assets/login-image.(jpg,
// jpeg, png, webp or avif) and it appears in that half, filling it; with none,
// the half is a plain surface. The glob is resolved at build time, so there is
// no request for a file that is not there and nothing to change in this module.
//
// Signing in and creating an account are one page with a switch, because the
// two share every field but the name. Success needs no handling here: the
// session announces it, and the shell moves on (see pandemonium-app.js and
// gate.js), which is why this component never navigates after a sign-in.
const IMAGES = import.meta.glob('../../assets/login-image.{jpg,jpeg,png,webp,avif}', {
  eager: true, query: '?url', import: 'default',
});
const IMAGE_URL = Object.values(IMAGES)[0] || '';

const MODES = [{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'Create account' }];

export class PandemoniumLogin extends LitElement {
  static properties = {
    _mode: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  static styles = css`
    :host{
      position:fixed;inset:0;z-index:60;background:var(--bg);color:var(--ink);font-family:var(--sans);
      display:grid;grid-template-columns:1fr 1fr;
    }
    .side{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:auto}
    .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 36px;flex:none}
    .home{background:none;border:0;padding:4px;margin:-4px;border-radius:8px;cursor:pointer;display:flex}
    pd-logo{font-size:20px;color:var(--res)}
    .main{flex:1;display:flex;align-items:center;justify-content:center;padding:12px 36px 40px}
    form{width:min(380px,100%);display:flex;flex-direction:column;gap:16px}
    pd-segmented{align-self:flex-start}
    h1{font-size:30px;line-height:1.1;letter-spacing:-.02em;font-weight:600;margin:10px 0 0}
    .sub{font-size:14px;line-height:1.5;color:var(--ui);margin:-8px 0 4px}
    label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500;color:var(--ui)}
    input{
      font-family:var(--sans);font-size:14px;height:40px;padding:0 14px;box-sizing:border-box;width:100%;
      border-radius:12px;color:var(--ink);background:var(--field);outline:none;
      border:1px solid color-mix(in srgb,var(--btn-line) 55%,transparent);
      transition:border-color var(--dur-1) var(--ease-out);
    }
    input:focus-visible{border-color:var(--link)}
    .hint{font-size:11px;color:var(--mut);font-weight:400}
    .err{font-size:13px;line-height:1.4;color:var(--danger)}
    .foot{padding:0 36px 26px;font-size:12px;color:var(--mut);flex:none}
    .foot i{font-style:italic}

    /* The picture's half. A plain surface until an image is supplied; the image
       fills it, since this is a backdrop and not a figure to be shown whole. */
    .art{background:var(--panel);position:relative;min-width:0}
    .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}

    @media (max-width:860px){
      :host{grid-template-columns:1fr}
      .art{display:none}
      .bar,.main,.foot{padding-left:22px;padding-right:22px}
    }
  `;

  constructor() {
    super();
    this._mode = 'signin';
    this._busy = false;
    this._error = '';
  }

  firstUpdated() {
    const email = this.renderRoot.getElementById('email');
    if (email) email.focus();
  }

  #home() {
    dispatch(this, 'pandemonium-navigate', { path: '/' });
  }

  #setMode(mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    this._error = '';
  }

  async #submit() {
    if (this._busy) return;
    const root = this.renderRoot;
    const email = root.getElementById('email').value.trim();
    const password = root.getElementById('password').value;
    const register = this._mode === 'register';
    const name = register ? root.getElementById('name').value.trim() : '';
    if (!email || !password) {
      this._error = 'Enter your email and password.';
      return;
    }
    this._busy = true;
    this._error = '';
    try {
      if (register) await session.register(email, password, name);
      else await session.login(email, password);
    } catch (err) {
      // fetch() rejects with a TypeError when the server cannot be reached at
      // all, and its own message ("Failed to fetch") means nothing to a person.
      this._error = err instanceof TypeError
        ? 'Could not reach the server. Check your connection and try again.'
        : (err && err.message) || 'Something went wrong. Try again.';
    } finally {
      this._busy = false;
    }
  }

  #onEnter(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.#submit(); }
  }

  render() {
    const register = this._mode === 'register';
    return html`
      <div class="side">
        <div class="bar">
          <button class="home" title="Back to the home page" aria-label="Back to the home page" @click=${() => this.#home()}><pd-logo></pd-logo></button>
          <pd-button variant="ghost" @click=${() => this.#home()}>Back</pd-button>
        </div>

        <div class="main">
          <form novalidate data-clarity-mask="true" @submit=${(e) => e.preventDefault()}>
            <pd-segmented .options=${MODES} .value=${this._mode} label="Sign in or create an account"
              @change=${(e) => this.#setMode(e.detail.value)}></pd-segmented>
            <h1>${register ? 'Create your account' : 'Welcome back'}</h1>
            <div class="sub">${register
              ? 'Your projects are saved to your account, so you can open them on any device.'
              : 'Sign in to open your projects.'}</div>

            ${register ? html`
              <label>Name (optional)
                <input id="name" type="text" autocomplete="name" @keydown=${(e) => this.#onEnter(e)}>
              </label>` : nothing}
            <label>Email
              <input id="email" type="email" autocomplete="email" @keydown=${(e) => this.#onEnter(e)}>
            </label>
            <label>Password
              <input id="password" type="password" autocomplete=${register ? 'new-password' : 'current-password'}
                @keydown=${(e) => this.#onEnter(e)}>
              ${register ? html`<span class="hint">At least 8 characters.</span>` : nothing}
            </label>

            ${this._error ? html`<div class="err" role="alert">${this._error}</div>` : nothing}

            <pd-button variant="pink" size="lg" block ?disabled=${this._busy} @click=${() => this.#submit()}>
              ${this._busy ? 'Working...' : (register ? 'Create account' : 'Sign in')}
            </pd-button>
          </form>
        </div>

        <div class="foot">A Project by <i>Common Genius</i></div>
      </div>

      <div class="art" aria-hidden="true">
        ${IMAGE_URL ? html`<img src=${IMAGE_URL} alt="">` : nothing}
      </div>
    `;
  }
}

customElements.define('pandemonium-login', PandemoniumLogin);

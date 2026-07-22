'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { session } from '../../data/session.js';
import { listProjectsRemote, deleteProjectRemote } from '../../data/remote-api-adapter.js';
import { dispatch } from '../../utils/events.js';
import { formStyles } from '../../styles/shared.js';
import '../ui/button.js';

// One instance lives at app-root, opened by dispatching `pandemonium-open-account`.
// It is both the sign-in surface and, once signed in, the cloud project picker.
// Folding both into one overlay keeps the account flow to a single component and
// a single app-root hook. Loading a chosen project is routed back up through an
// event (not done here) so app-root can cancel the pending autosave first, the
// same discipline the New/local flows already follow.
export class PdAccountDialog extends LitElement {
  static properties = {
    _open: { state: true },
    _tab: { state: true }, // 'signin' | 'register'
    _busy: { state: true },
    _error: { state: true },
    _projects: { state: true }, // null while loading, [] when empty
  };

  static styles = [formStyles, css`
    :host{position:fixed;inset:0;z-index:88}
    :host(:not([data-open])){pointer-events:none}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;pointer-events:auto}
    .dlg{
      width:min(400px,92vw);background:var(--bg);border-radius:var(--r);padding:18px;
      display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow:auto;font-family:var(--sans);
    }
    h3{font-size:15px;font-weight:600;color:var(--ink);margin:0}
    .sub{font-size:12px;color:var(--mut);margin:-6px 0 2px}
    label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ui)}
    input{
      font-family:var(--sans);font-size:13px;padding:7px 9px;border-radius:var(--r);
      border:1px solid var(--btn-line);background:#fff;color:var(--ink);
    }
    .err{font-size:12px;color:var(--res)}
    .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .toggle{background:none;border:0;color:var(--res);font-size:12px;cursor:pointer;padding:0;font-family:var(--sans)}
    .list{display:flex;flex-direction:column;gap:6px;margin:2px 0}
    .proj{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:8px 10px;border-radius:var(--r);background:var(--panel);cursor:pointer;
    }
    .proj:hover{background:var(--ph)}
    .proj .name{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj .when{font-size:11px;color:var(--mut);flex:none}
    .empty{font-size:12px;color:var(--mut);padding:6px 0}
    .who{font-size:12px;color:var(--ui)}
    .who b{color:var(--ink)}
  `];

  constructor() {
    super();
    this._open = false;
    this._tab = 'signin';
    this._busy = false;
    this._error = '';
    this._projects = null;
    this._store = new StoreController(this);
    this._onSession = () => this.#onSessionChange();
  }

  connectedCallback() {
    super.connectedCallback();
    session.addEventListener('change', this._onSession);
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) this.close(); };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    session.removeEventListener('change', this._onSession);
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  open() {
    this._open = true;
    this._error = '';
    this.setAttribute('data-open', '');
    if (session.isAuthed()) this.#loadProjects();
    this.updateComplete.then(() => {
      const f = this.renderRoot.querySelector('input');
      if (f) f.focus();
    });
  }

  close() {
    this._open = false;
    this.removeAttribute('data-open');
  }

  #onSessionChange() {
    // Signing in from within this dialog flips it to the project list; signing
    // out flips it back to the form.
    if (this._open && session.isAuthed() && this._projects === null) this.#loadProjects();
    this.requestUpdate();
  }

  async #loadProjects() {
    this._projects = null;
    try {
      this._projects = await listProjectsRemote();
    } catch (err) {
      this._error = 'Could not load your cloud projects.';
      this._projects = [];
    }
  }

  async #submit() {
    const root = this.renderRoot;
    const email = root.getElementById('email').value.trim();
    const password = root.getElementById('password').value;
    const name = this._tab === 'register' ? root.getElementById('name').value.trim() : '';
    this._busy = true;
    this._error = '';
    try {
      if (this._tab === 'register') await session.register(email, password, name);
      else await session.login(email, password);
      // If work is open, adopt it into the account so nothing is lost; the user
      // stays on that project (now syncing) rather than being bounced to a list.
      if (this._store.project) {
        dispatch(this, 'pandemonium-push-current-to-cloud', {});
        this.close();
        dispatch(this, 'pandemonium-toast', { message: 'Signed in. This project now syncs to your account.' });
      }
      // Otherwise the render flips to the cloud project list automatically.
    } catch (err) {
      this._error = err.message || 'Sign in failed.';
    } finally {
      this._busy = false;
    }
  }

  #openProject(id) {
    dispatch(this, 'pandemonium-open-remote-project', { id });
    this.close();
  }

  async #deleteProject(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this project from your account? This cannot be undone.')) return;
    try {
      await deleteProjectRemote(id);
      this._projects = this._projects.filter((p) => p.id !== id);
    } catch (err) {
      this._error = 'Could not delete that project.';
    }
  }

  async #signOut() {
    await session.logout();
    this._projects = null;
    this._tab = 'signin';
  }

  #fmtWhen(iso) {
    try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
  }

  #renderForm() {
    const isRegister = this._tab === 'register';
    return html`
      <h3>${isRegister ? 'Create your account' : 'Sign in to sync'}</h3>
      <div class="sub">Save projects to your account and open them on any device.</div>
      ${isRegister ? html`
        <label>Name (optional)
          <input id="name" type="text" autocomplete="name">
        </label>` : ''}
      <label>Email
        <input id="email" type="email" autocomplete="email" @keydown=${(e) => e.key === 'Enter' && this.#submit()}>
      </label>
      <label>Password
        <input id="password" type="password" autocomplete=${isRegister ? 'new-password' : 'current-password'}
          @keydown=${(e) => e.key === 'Enter' && this.#submit()}>
      </label>
      ${this._error ? html`<div class="err">${this._error}</div>` : ''}
      <div class="row">
        <button class="toggle" @click=${() => { this._tab = isRegister ? 'signin' : 'register'; this._error = ''; }}>
          ${isRegister ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
        <pd-button variant="act" ?disabled=${this._busy} @click=${() => this.#submit()}>
          ${this._busy ? 'Working...' : (isRegister ? 'Create account' : 'Sign in')}
        </pd-button>
      </div>
    `;
  }

  #renderAccount() {
    const user = session.getUser();
    return html`
      <div class="row">
        <h3>Your cloud projects</h3>
        <pd-button @click=${() => this.#signOut()}>Sign out</pd-button>
      </div>
      <div class="who">Signed in as <b>${user ? user.email : ''}</b></div>
      ${this._error ? html`<div class="err">${this._error}</div>` : ''}
      ${this._projects === null
        ? html`<div class="empty">Loading...</div>`
        : this._projects.length === 0
          ? html`<div class="empty">No cloud projects yet. Any project you have open is saved to your account automatically.</div>`
          : html`<div class="list">
              ${this._projects.map((p) => html`
                <div class="proj" @click=${() => this.#openProject(p.id)} title="Open">
                  <span class="name">${p.name || 'Untitled'}</span>
                  <span class="when">${this.#fmtWhen(p.updatedAt)}</span>
                  <pd-button variant="ghost" @click=${(e) => this.#deleteProject(e, p.id)}>Delete</pd-button>
                </div>`)}
            </div>`}
    `;
  }

  render() {
    if (!this._open) return html``;
    return html`
      <div class="ov" @mousedown=${(e) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="dlg">
          ${session.isAuthed() ? this.#renderAccount() : this.#renderForm()}
        </div>
      </div>
    `;
  }
}

customElements.define('pd-account-dialog', PdAccountDialog);

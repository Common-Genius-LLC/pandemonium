'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { session } from '../../data/session.js';
import { listShares, addShare, removeShare, getReadLink, createReadLink, revokeReadLink, readLinkUrl } from '../../data/db.js';
import { dispatch } from '../../utils/events.js';
import { formStyles } from '../../styles/shared.js';
import '../ui/button.js';

// Sharing for the currently open cloud project. One instance at app-root,
// opened via `pandemonium-open-share`. Follows the account dialog's shape:
// same overlay, same form kit, same state fields.
//
// Two things it can grant, matching what the backend can actually enforce:
//   - a collaborator, by the email of an existing account, as viewer or
//     editor (grants are project-scoped: see docs/BACKEND_ARCHITECTURE.md,
//     addendum B, for why per-script grants would be a false promise)
//   - a read-only link that opens the final draft and its boards with no
//     account at all
export class PdShareDialog extends LitElement {
  static properties = {
    _open: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _shares: { state: true },   // null while loading
    _linkToken: { state: true },
    _copied: { state: true },
  };

  static styles = [formStyles, css`
    :host{position:fixed;inset:0;z-index:88;font-family:var(--sans)}
    :host(:not([data-open])){pointer-events:none;display:none}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center}
    .dlg{
      width:min(440px,92vw);background:var(--bg);border-radius:var(--r);padding:18px;
      display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow:auto;
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    h3{font-size:15px;font-weight:600;color:var(--ink);margin:0}
    .sub{font-size:12px;color:var(--mut);margin:-6px 0 2px;line-height:1.5}
    .err{font-size:12px;color:var(--res)}
    .addrow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center}
    input,select{
      font-family:var(--sans);font-size:13px;padding:7px 9px;border-radius:var(--r);
      border:1px solid var(--btn-line);background:var(--field);color:var(--ink);
    }
    select{padding:6px}
    .list{display:flex;flex-direction:column;gap:6px}
    .person{
      display:flex;align-items:center;gap:8px;padding:7px 10px;
      border-radius:var(--r);background:var(--panel);
    }
    .person .who{flex:1;min-width:0;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .person .role{flex:none;font-size:11px;color:var(--mut)}
    .lbl2{font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);margin-top:4px}
    .linkrow{display:flex;gap:6px;align-items:center}
    .linkrow input{flex:1;min-width:0;font-family:var(--mono);font-size:11px}
    .none{font-size:12px;color:var(--mut)}
    .x{margin-left:auto}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._open = false;
    this._busy = false;
    this._error = '';
    this._shares = null;
    this._linkToken = null;
    this._copied = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) this.close(); };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  #projectId() { return session.getCurrentRemoteId(); }

  open() {
    // Sharing needs the project to exist on the server: the grant rows point
    // at its id. Signed out, or a purely local project, has nothing to point
    // at, and saying so beats a dialog whose every action would fail.
    if (!session.isAuthed() || !this.#projectId()) {
      dispatch(this, 'pandemonium-toast', { message: 'Sign in first: sharing needs the project synced to your account.' });
      return;
    }
    this._open = true;
    this._error = '';
    this._copied = false;
    this.setAttribute('data-open', '');
    this.#load();
  }

  close() {
    this._open = false;
    this.removeAttribute('data-open');
  }

  async #load() {
    this._shares = null;
    this._linkToken = null;
    try {
      const [shares, link] = await Promise.all([
        listShares(this.#projectId()),
        getReadLink(this.#projectId()),
      ]);
      this._shares = shares;
      this._linkToken = link.token;
    } catch (err) {
      // The likely cause is opening someone ELSE's project (grants are owner
      // managed, so the server answers 404 here for a collaborator).
      this._error = 'Only the project owner can manage sharing.';
      this._shares = [];
    }
  }

  async #add() {
    const email = this.renderRoot.getElementById('shareEmail').value.trim();
    const role = this.renderRoot.getElementById('shareRole').value;
    if (!email) return;
    this._busy = true;
    this._error = '';
    try {
      const share = await addShare(this.#projectId(), email, role);
      this._shares = [...(this._shares || []).filter((s) => s.id !== share.id), share];
      this.renderRoot.getElementById('shareEmail').value = '';
    } catch (err) {
      this._error = err.message || 'Could not share.';
    } finally {
      this._busy = false;
    }
  }

  async #remove(share) {
    try {
      await removeShare(this.#projectId(), share.id);
      this._shares = this._shares.filter((s) => s.id !== share.id);
    } catch (err) {
      this._error = err.message || 'Could not remove that person.';
    }
  }

  async #mintLink() {
    this._busy = true;
    try {
      const out = await createReadLink(this.#projectId());
      this._linkToken = out.token;
    } catch (err) {
      this._error = err.message || 'Could not create a link.';
    } finally {
      this._busy = false;
    }
  }

  async #revokeLink() {
    if (!confirm('Revoke this link? Anyone holding it loses access immediately.')) return;
    try {
      await revokeReadLink(this.#projectId());
      this._linkToken = null;
    } catch (err) {
      this._error = err.message || 'Could not revoke the link.';
    }
  }

  async #copyLink() {
    try {
      await navigator.clipboard.writeText(readLinkUrl(this._linkToken));
      this._copied = true;
      setTimeout(() => { this._copied = false; }, 1600);
    } catch {
      // Clipboard can be denied; the URL is visible in the field to copy by hand.
    }
  }

  render() {
    if (!this._open) return html``;
    const project = this._store.project;
    return html`
      <div class="ov" @mousedown=${(e) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="dlg">
          <h3>Share "${(project && project.name) || 'this project'}"</h3>
          <div class="sub">
            Collaborators need a Pandemonium account. An editor can change the project,
            and edits from two people merge like branches: nothing is overwritten without being shown.
          </div>
          ${this._error ? html`<div class="err">${this._error}</div>` : ''}

          <div class="addrow">
            <input id="shareEmail" type="email" placeholder="collaborator@email.com"
              @keydown=${(e) => e.key === 'Enter' && this.#add()}>
            <select id="shareRole" title="What this person can do">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <pd-button variant="act" ?disabled=${this._busy} @click=${() => this.#add()}>Share</pd-button>
          </div>

          ${this._shares === null
            ? html`<div class="none">Loading...</div>`
            : this._shares.length === 0
              ? html`<div class="none">Not shared with anyone yet.</div>`
              : html`<div class="list">
                  ${this._shares.map((s) => html`
                    <div class="person">
                      <span class="who">${s.displayName ? s.displayName + ' · ' : ''}${s.email}</span>
                      <span class="role">${s.role}</span>
                      <pd-button class="x" variant="ghost" @click=${() => this.#remove(s)}>Remove</pd-button>
                    </div>`)}
                </div>`}

          <div class="lbl2">Read-only link</div>
          <div class="sub">Opens the final draft and its storyboards. No account needed. Revocable any time.</div>
          ${this._linkToken
            ? html`
              <div class="linkrow">
                <input readonly .value=${readLinkUrl(this._linkToken)} @focus=${(e) => e.target.select()}>
                <pd-button @click=${() => this.#copyLink()}>${this._copied ? 'Copied' : 'Copy'}</pd-button>
                <pd-button variant="ghost" @click=${() => this.#revokeLink()}>Revoke</pd-button>
              </div>`
            : html`<div class="linkrow">
                <pd-button ?disabled=${this._busy} @click=${() => this.#mintLink()}>Create link</pd-button>
              </div>`}
        </div>
      </div>
    `;
  }
}

customElements.define('pd-share-dialog', PdShareDialog);

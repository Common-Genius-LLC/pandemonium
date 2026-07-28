'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { FEEDBACK_CONTACT } from '../../config/beta.js';
import { bugReporter, buildReport, submitReport } from '../../utils/bug-report.js';
import { trackBugReport } from '../../utils/analytics.js';
import { dispatch } from '../../utils/events.js';
import { formStyles } from '../../styles/shared.js';
import '../ui/button.js';

// One instance at app-root, opened by dispatching `pandemonium-open-bug-report`.
// A dedicated component rather than a pd-dialog body because submitting is
// async and can partly fail (posted vs copied to clipboard), and the tester has
// to be told which of those happened.
//
// Deliberately two fields and a checkbox. A beta tester who hits a bug is
// already annoyed, and every extra required field is a reason to close the box
// instead. Everything else worth knowing is collected automatically.
export class PdBugReportDialog extends LitElement {
  static properties = {
    _open: { state: true },
    _kind: { state: true },
    _busy: { state: true },
    _done: { state: true },   // '' | 'endpoint' | 'clipboard' | 'download'
    _error: { state: true },
  };

  static styles = [formStyles, css`
    :host{position:fixed;inset:0;z-index:88}
    :host(:not([data-open])){pointer-events:none}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;pointer-events:auto}
    .dlg{
      width:min(440px,92vw);background:var(--bg);border-radius:var(--r);padding:18px;
      display:flex;flex-direction:column;gap:12px;max-height:86vh;overflow:auto;font-family:var(--sans);
    }
    h3{font-size:15px;font-weight:600;color:var(--ink);margin:0}
    .sub{font-size:12px;color:var(--mut);margin:-6px 0 2px;line-height:1.5}
    label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ui)}
    .kinds{display:flex;gap:4px}
    .kinds button{
      flex:1;height:26px;font-family:var(--sans);font-size:11px;font-weight:500;
      color:var(--mut);background:var(--panel);border:0;border-radius:var(--r);cursor:pointer;
    }
    .kinds button.on{background:var(--overlay);color:var(--overlay-ink)}
    .check{flex-direction:row;align-items:flex-start;gap:7px;font-size:11px;color:var(--mut);line-height:1.5}
    .check input{margin:2px 0 0;flex:none}
    .foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px}
    .note{font-size:11px;color:var(--mut)}
    .err{font-size:12px;color:var(--res)}
    .ok{font-size:12px;color:var(--ok);line-height:1.5}
  `];

  constructor() {
    super();
    this._open = false;
    this._kind = 'bug';
    this._busy = false;
    this._done = '';
    this._error = '';
    this._store = new StoreController(this);
  }

  open() {
    this._open = true;
    this._done = '';
    this._error = '';
    this._kind = 'bug';
    this.setAttribute('data-open', '');
    this.updateComplete.then(() => {
      const f = this.renderRoot.querySelector('textarea');
      if (f) f.focus();
    });
  }

  close() {
    this._open = false;
    this.removeAttribute('data-open');
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKey = (e) => { if (e.key === 'Escape' && this._open && !this._busy) this.close(); };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  #field(sel) {
    const el = this.renderRoot.querySelector(sel);
    return el ? el.value.trim() : '';
  }

  async #send() {
    const message = this.#field('#what');
    if (!message) {
      this._error = 'Tell us what happened first.';
      return;
    }
    this._busy = true;
    this._error = '';

    const includeProject = this.renderRoot.querySelector('#attach').checked;
    // The store arrives through context, so it can in principle still be
    // unresolved. A report that loses its context is worth far more than one
    // that throws on the way out.
    const store = this._store.store || null;
    const report = buildReport({
      kind: this._kind,
      message,
      steps: this.#field('#steps'),
      email: this.#field('#email'),
      includeProject,
      store,
      view: store ? store.viewPath() : '',
    });

    const { ok, channel } = await submitReport(report);
    this._busy = false;

    if (!ok) {
      this._error = 'Could not send or copy the report. Check the console and try again.';
      return;
    }
    // Counts only: the report body itself never goes to analytics.
    trackBugReport({
      report_kind: this._kind,
      channel,
      with_project: includeProject,
      error_count: report.errors.length,
    });
    bugReporter.clearErrors();
    this._done = channel;
  }

  #doneMessage() {
    if (this._done === 'endpoint') return 'Sent. Thank you, this is genuinely useful.';
    if (this._done === 'clipboard') {
      return FEEDBACK_CONTACT
        ? `Copied to your clipboard. Please paste it to ${FEEDBACK_CONTACT}.`
        : 'Copied to your clipboard. Please paste it wherever you are sending feedback.';
    }
    return 'Saved as a file. Please send it along with your feedback.';
  }

  render() {
    if (!this._open) return html``;
    return html`
      <div class="ov" @mousedown=${(e) => { if (e.target === e.currentTarget && !this._busy) this.close(); }}>
        <div class="dlg">
          ${this._done ? html`
            <h3>Report sent</h3>
            <div class="ok">${this.#doneMessage()}</div>
            <div class="foot">
              <span></span>
              <pd-button variant="act" @click=${() => this.close()}>Close</pd-button>
            </div>
          ` : html`
            <h3>Report a problem</h3>
            <div class="sub">
              You are on a beta build. Your browser, screen size, what you were
              looking at, and any errors already logged are attached
              automatically. Your script is not.
            </div>

            <div class="kinds">
              ${['bug', 'confusing', 'idea'].map((k) => html`
                <button
                  class=${this._kind === k ? 'on' : ''}
                  @click=${() => { this._kind = k; }}
                >${k === 'bug' ? 'Something broke' : k === 'confusing' ? 'Confusing' : 'Idea'}</button>
              `)}
            </div>

            <label class="field">
              What happened?
              <textarea id="what" placeholder="What you expected, and what happened instead."></textarea>
            </label>

            <label class="field">
              What were you doing just before? (optional)
              <textarea id="steps" style="min-height:64px" placeholder="Rough steps are fine."></textarea>
            </label>

            <label class="field">
              Email, if we can follow up (optional)
              <input id="email" type="text" placeholder="you@example.com">
            </label>

            <label class="check">
              <input id="attach" type="checkbox">
              <span>
                Attach a copy of this project so the bug can be reproduced.
                This includes your script text. Board images are stripped out.
              </span>
            </label>

            ${this._error ? html`<div class="err">${this._error}</div>` : ''}

            <div class="foot">
              <span class="note">
                ${bugReporter.errorCount
                  ? `${bugReporter.errorCount} logged error${bugReporter.errorCount === 1 ? '' : 's'} attached`
                  : 'No errors logged this session'}
              </span>
              <span style="display:flex;gap:6px">
                <pd-button ?disabled=${this._busy} @click=${() => this.close()}>Cancel</pd-button>
                <pd-button variant="act" ?disabled=${this._busy} @click=${() => this.#send()}>
                  ${this._busy ? 'Sending...' : 'Send report'}
                </pd-button>
              </span>
            </div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('pd-bug-report-dialog', PdBugReportDialog);

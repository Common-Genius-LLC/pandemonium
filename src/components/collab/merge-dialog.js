'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import '../ui/button.js';

// The sync conflict resolver. Renders whenever ui.merge is set (see
// store.beginMerge): someone else wrote to this project while this device was
// editing, the automatic three-way merge handled everything it could, and
// what is on screen here is only the remainder that needs a human.
//
// Git-shaped on purpose: each hunk shows both versions side by side and takes
// one of Keep mine / Keep theirs (/ Keep both, script text only, where
// concatenation is a meaningful answer). The commit button stays disabled
// until every hunk is resolved, because a dismissable conflict is a silent
// choice, and silent choices are how the old last-write-wins path lost work.
//
// "Decide later" is genuinely safe: nothing has been written to the server,
// the local state is untouched, and the next autosave will raise the same
// conflict again.
export class PdMergeDialog extends LitElement {
  static styles = css`
    :host{position:fixed;inset:0;z-index:89;font-family:var(--sans)}
    :host(:not([data-open])){display:none}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center}
    .dlg{
      width:min(760px,94vw);max-height:88vh;overflow:auto;background:var(--bg);
      border-radius:var(--r);padding:18px;display:flex;flex-direction:column;gap:12px;
      scrollbar-width:thin;scrollbar-color:var(--ph) transparent;
    }
    h3{font-size:15px;font-weight:600;color:var(--ink);margin:0}
    .sub{font-size:12px;color:var(--mut);line-height:1.5}
    .hunk{background:var(--panel);border-radius:var(--r);padding:10px;display:flex;flex-direction:column;gap:8px}
    .where{font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .ver{min-width:0;display:flex;flex-direction:column;gap:4px}
    .ver .tag{font-size:10px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
    .ver pre{
      margin:0;padding:8px;background:var(--field);border-radius:var(--r);
      font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--ink);
      white-space:pre-wrap;overflow-wrap:break-word;max-height:180px;overflow:auto;
      scrollbar-width:thin;
    }
    .ver.gone pre{color:var(--mut);font-style:italic;font-family:var(--sans)}
    .picks{display:flex;gap:4px;flex-wrap:wrap}
    .picks button{
      font-size:11px;padding:4px 10px;border:1px solid var(--btn-line);border-radius:var(--r);
      background:var(--btn-bg);color:var(--ui);cursor:pointer;font-family:var(--sans);
    }
    .picks button:hover{background:var(--btn-hi)}
    .picks button.on{background:var(--act);color:var(--act-ink);border-color:var(--act)}
    .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
    .left{font-size:12px;color:var(--mut)}
    .acts{display:flex;gap:6px}
    @media (max-width:640px){.cols{grid-template-columns:1fr}}
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  updated() {
    const merge = this._store.ui && this._store.ui.merge;
    if (merge) this.setAttribute('data-open', '');
    else this.removeAttribute('data-open');
  }

  #pick(index, resolution) { this._store.store.resolveMergeHunk(index, resolution); }

  #commit() {
    const merge = this._store.ui.merge;
    const out = this._store.store.commitMerge();
    if (!out) return;
    // The store applied the merged project; app-root pushes it to the server
    // with the concurrency token the conflict reported, so the write cannot
    // 409 against the very version it just reconciled.
    dispatch(this, 'pandemonium-merge-committed', { project: out.project, theirUpdatedAt: merge.theirUpdatedAt });
    dispatch(this, 'pandemonium-toast', { message: 'Merged. Your resolution is syncing now.' });
  }

  #later() {
    this._store.store.cancelMerge();
    dispatch(this, 'pandemonium-toast', { message: 'Merge postponed. Nothing was overwritten; it will come back on the next sync.' });
  }

  #describeRecord(collection, rec) {
    if (!rec) return null;
    if (collection === 'boards') return (rec.caption ? rec.caption + ' · ' : '') + (rec.img ? 'has image' : 'blank board');
    if (collection === 'research') return (rec.title || 'Untitled') + (rec.url ? ' · ' + rec.url : '');
    if (collection === 'comments') return rec.body || '(empty comment)';
    if (collection === 'links') return 'link to ' + (rec.researchId || 'a source');
    return JSON.stringify(rec).slice(0, 140);
  }

  #ver(tag, content, gone) {
    return html`
      <div class="ver ${gone ? 'gone' : ''}">
        <span class="tag">${tag}</span>
        <pre>${gone ? 'deleted' : content}</pre>
      </div>`;
  }

  #hunk(h, index) {
    const where = h.kind === 'script'
      ? `Script · ${h.scriptName || 'draft'}`
      : `${h.collection.slice(0, -1)} ${h.mine === null ? '(you deleted it)' : h.theirs === null ? '(they deleted it)' : ''}`;
    const mineText = h.kind === 'script' ? h.mine.join('\n') : this.#describeRecord(h.collection, h.mine);
    const theirText = h.kind === 'script' ? h.theirs.join('\n') : this.#describeRecord(h.collection, h.theirs);
    // "Keep both" only means something for text, where the answer can be
    // "one after the other". For a record it would be an id collision.
    const canBoth = h.kind === 'script';
    return html`
      <div class="hunk">
        <span class="where">${where}</span>
        <div class="cols">
          ${this.#ver('Yours', mineText, h.mine === null)}
          ${this.#ver('Theirs', theirText, h.theirs === null)}
        </div>
        <div class="picks">
          <button class=${h.resolution === 'mine' ? 'on' : ''} @click=${() => this.#pick(index, 'mine')}>
            ${h.mine === null ? 'Keep it deleted' : 'Keep mine'}
          </button>
          <button class=${h.resolution === 'theirs' ? 'on' : ''} @click=${() => this.#pick(index, 'theirs')}>
            ${h.theirs === null ? 'Accept their deletion' : 'Keep theirs'}
          </button>
          ${canBoth ? html`
            <button class=${h.resolution === 'both' ? 'on' : ''} @click=${() => this.#pick(index, 'both')}>Keep both</button>` : ''}
        </div>
      </div>`;
  }

  render() {
    const ui = this._store.ui;
    const merge = ui && ui.merge;
    if (!merge) return html``;
    const hunks = merge.result.hunks;
    const unresolved = hunks.filter((h) => !h.resolution).length;
    return html`
      <div class="ov">
        <div class="dlg">
          <h3>Someone else changed this project</h3>
          <div class="sub">
            Another device or collaborator saved while you were editing. Everything that
            could merge on its own already has. These ${hunks.length === 1 ? 'is the one place' : `are the ${hunks.length} places`}
            where both versions changed the same thing, and nothing is written until you decide each one.
          </div>
          ${hunks.map((h, ix) => this.#hunk(h, ix))}
          <div class="foot">
            <span class="left">${unresolved ? `${unresolved} still to decide` : 'All decided.'}</span>
            <span class="acts">
              <pd-button @click=${() => this.#later()}>Decide later</pd-button>
              <pd-button variant="act" ?disabled=${unresolved > 0} @click=${() => this.#commit()}>Apply merge</pd-button>
            </span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pd-merge-dialog', PdMergeDialog);

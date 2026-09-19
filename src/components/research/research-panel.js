'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import { readFileAsDataURL, readFileAsText, isTextShaped } from '../../utils/files.js';
import { dispatch } from '../../utils/events.js';
import { filterResearch, normalizeUrl, allLabels, normalizeLabel } from '../../data/research-doc.js';
import { icon } from './icons.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './research-card.js';
import './research-reader.js';

// The research grid.
//
// Two ideas hold this panel together, and both exist so there is nothing to
// learn before using it.
//
// ONE RECORD. A source is one thing that can carry media, a URL and notes at
// once. The panel used to offer "+ Note" and "+ Link" as two kinds of thing to
// create, which was a question the writer could get wrong (and a "note" could
// hold a URL anyway, and a "link" a body; only the card's background colour
// ever noticed). There is one kind of thing now, so there is one way to make
// one, and it reports what it is from what it holds.
//
// ONE VISIBLE WAY IN, PLUS THE OBVIOUS ONES. Creating is a card at the head of
// the grid, shaped like the thing it makes, which is the whole instruction. It
// also names the two routes that are faster but invisible (drop a file, paste
// a link), so they are learned in the place they are used rather than in a
// tooltip. Both routes work anywhere on the panel.
export class PandemoniumResearchPanel extends LitElement {
  static properties = {
    leafId: {},
    _query: { state: true },
    _unlinkedOnly: { state: true },
    _labels: { state: true },
    _dragging: { state: true },
  };

  static styles = [panelStyles, css`
    .shell{position:relative}
    #researchList{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px;align-content:start;padding:10px 10px 24px}
    /* Search sits in the chrome strip with the buttons; it shrinks before they
       do, and is absent while there is nothing to search. */
    .find{position:relative;display:flex;align-items:center;min-width:0}
    .find svg{position:absolute;left:7px;width:12px;height:12px;fill:var(--mut);pointer-events:none}
    .find input{
      width:132px;min-width:64px;height:24px;box-sizing:border-box;padding:0 8px 0 24px;
      font-family:var(--sans);font-size:12px;color:var(--ink);
      background:var(--field);border:1px solid var(--btn-line);border-radius:20px;outline:none;
    }
    .find input:focus-visible{border-color:var(--link)}
    .find input::placeholder{color:var(--mut)}
    .filterbar{
      flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 8px;
      font-family:var(--sans);font-size:11px;color:var(--mut);
    }
    .filterbar button{font:inherit;color:var(--mut);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
    .filterbar button:hover{color:var(--ink)}

    /* Topics. A row of what the project actually uses, each chip a filter.
       Neutral, because a source's colour is the other way of sorting and two
       colour systems on one grid would be one more thing to keep straight. */
    .topics{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:0 10px 8px}
    .topics button{
      display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 10px;
      font-family:var(--sans);font-size:11px;font-weight:500;color:var(--ui);
      background:var(--panel);border:0;border-radius:20px;cursor:pointer;
    }
    .topics button:hover{background:var(--ph)}
    .topics button.on{background:var(--overlay);color:var(--overlay-ink)}
    .topics button i{font-style:normal;opacity:.6;font-weight:400}
    .topics button.clear{background:none;color:var(--mut);text-decoration:underline}
    .topics button.clear:hover{background:none;color:var(--ink)}

    /* The new-source tile. Card-shaped and card-sized because it makes a card:
       what it does is legible from what it looks like, with no label needed to
       bridge the two. --ph is the token for an empty lane, which is what this
       is. No dashed outline: the design language is solid fills, no borders. */
    .newcard{
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      min-height:112px;padding:14px 10px;box-sizing:border-box;
      background:var(--ph);border:0;border-radius:12.36px;cursor:pointer;
      font-family:var(--sans);color:var(--mut);text-align:center;
    }
    .newcard:hover{background:var(--ph-hi);color:var(--ink)}
    .newcard .plus{font-size:20px;line-height:1;font-weight:500}
    .newcard .nm{font-size:12px;font-weight:500}
    /* The two faster routes, named where they are used rather than in a
       tooltip that has to be hunted for. */
    .newcard .how{font-size:10px;line-height:1.4;opacity:.85}

    /* Empty pane: the same tile, alone, so the first thing ever seen here is
       the same object that stays at the head of the grid forever after. */
    .nores{height:100%;min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;box-sizing:border-box}
    .nores p{width:300px;max-width:82%;margin:0;text-align:center;font-size:14px;line-height:18px;color:var(--mut)}
    .nores .newcard{width:190px}

    /* Drop feedback covers the whole working area and says what will happen,
       rather than tinting an outline and changing a button somewhere else. */
    .dropzone{
      position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;
      background:var(--res);color:#fff;font-family:var(--sans);font-size:14px;font-weight:500;
      border-radius:20px;pointer-events:none;
    }
    /* While the script waits for a source, the panel says what it is waiting
       for and offers the way out of an empty-handed pick. A mode is only
       acceptable when it announces itself. */
    .picking{
      flex:none;display:flex;align-items:center;gap:10px;margin:0 10px 8px;padding:8px 12px;
      background:var(--res);color:#fff;border-radius:20px;font-family:var(--sans);font-size:11px;
    }
    .picking span{flex:1;min-width:0}
    .picking button{
      font:inherit;font-weight:500;color:#fff;background:rgba(255,255,255,.2);height:22px;padding:0 10px;
      border:0;border-radius:20px;cursor:pointer;flex:none;
    }
    .picking button:hover{background:rgba(255,255,255,.34)}
  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._query = '';
    this._unlinkedOnly = false;
    this._labels = new Set(); // topics currently being shown, empty means all
    this._dragging = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // A pasted URL or image becomes a source, the same as a dropped one. Bound
    // at the document because a panel is not focusable and a paste with no
    // focused field otherwise goes nowhere; #pasteWanted keeps it to pastes
    // that were plainly aimed here.
    this._onPaste = (e) => this.#onPaste(e);
    document.addEventListener('paste', this._onPaste);
    this._onEnter = () => { this._hovered = true; };
    this._onLeave = () => { this._hovered = false; };
    this.addEventListener('mouseenter', this._onEnter);
    this.addEventListener('mouseleave', this._onLeave);
    // A chip clicked on a card filters the grid to that topic, so the topic
    // row and the chips on the cards are the same control seen twice.
    this.addEventListener('pandemonium-pick-label', (e) => this.#toggleLabel(e.detail.label));
  }

  disconnectedCallback() {
    document.removeEventListener('paste', this._onPaste);
    this.removeEventListener('mouseenter', this._onEnter);
    this.removeEventListener('mouseleave', this._onLeave);
    super.disconnectedCallback();
  }

  // ---- creating ----

  // While the script is waiting for a source to be picked, anything created
  // here IS the answer to that wait: link it to the pending passage and put
  // the wait away. Otherwise the writer creates the source, then has to
  // remember they were mid-link and go back to click the card they are already
  // looking at. Returns true when a link was made.
  #consumePendingLink(docId) {
    const store = this._store.store;
    const linking = store.ui.linking;
    if (!linking || linking.from !== 'script' || !linking.parts) return false;
    store.addLink({ researchId: docId, sParts: linking.parts, rParts: null });
    store.setUI({ linking: null });
    return true;
  }

  // A source is made and opened with the caret already in its notes. No dialog
  // asking for a title, a kind and a URL first: there is nothing to ask that
  // the writer would not rather just type, and an empty source shows its own
  // fields anyway.
  #newSource() {
    const store = this._store.store;
    const doc = store.addResearch({});
    const linked = this.#consumePendingLink(doc.id);
    store.setUI({ openDoc: doc.id, openDocFocus: true });
    if (linked) dispatch(this, 'pandemonium-toast', { message: 'Source created and linked to the passage.' });
  }

  #upload() {
    const input = this.renderRoot.getElementById('fileRes');
    input.value = '';
    input.click();
  }

  async #onFilePicked(e) {
    await this.#addFiles(e.target.files || []);
  }

  // One source per file, titled with the file name.
  //
  // A text-shaped file (.txt, .md, .fountain, anything text/*) is read into the
  // source's notes instead of being stored as media, because prose that lives
  // in `body` can have any passage of it linked to the script, while the same
  // prose kept as an opaque attachment can only ever be linked as a whole.
  // Everything else is stored as a data URL like every other embedded file in a
  // project (see db.js); the remote adapter lifts it into the asset store on
  // sync.
  async #addFiles(files) {
    const list = [...files];
    if (!list.length) return;
    let last = null;
    for (const file of list) {
      last = isTextShaped(file)
        ? this._store.store.addResearch({ title: file.name, body: await readFileAsText(file) })
        : this._store.store.addResearch({
          title: file.name,
          attachment: { name: file.name, mime: file.type, data: await readFileAsDataURL(file) },
        });
    }
    // One file opens: the writer almost always wants to look at it or write a
    // note under it. Several stay in the grid, which is where they can be
    // compared. Either way the last one answers a pending link.
    const linked = last ? this.#consumePendingLink(last.id) : false;
    if (list.length === 1 && last) this._store.store.setUI({ openDoc: last.id });
    dispatch(this, 'pandemonium-toast', {
      message: list.length === 1
        ? (linked ? 'Source added and linked to the passage.' : 'Source added.')
        : list.length + ' sources added.' + (linked ? ' The last one is linked to the passage.' : ''),
    });
  }

  #addUrl(url) {
    const store = this._store.store;
    const doc = store.addResearch({ url });
    const linked = this.#consumePendingLink(doc.id);
    store.setUI({ openDoc: doc.id, openDocFocus: true });
    dispatch(this, 'pandemonium-toast', {
      message: linked ? 'Link added and linked to the passage.' : 'Link added.',
    });
    return doc;
  }

  // ---- drops and pastes ----

  #dragHasContent(dt) {
    const types = [...(dt.types || [])];
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
  }

  #onDragOver(e) {
    if (!this.#dragHasContent(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!this._dragging) this._dragging = true;
  }

  #onDragLeave(e) {
    // dragleave bubbles out of children too; only a real exit counts.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    this._dragging = false;
  }

  async #onDrop(e) {
    if (!this.#dragHasContent(e.dataTransfer)) return;
    e.preventDefault();
    this._dragging = false;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) { await this.#addFiles(files); return; }
    // Dragging a link out of a browser gives text, not a file. It used to be
    // ignored, which is the one thing a research panel should never do with a
    // dropped URL.
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const url = normalizeUrl((text || '').split('\n')[0]);
    if (url) this.#addUrl(url);
  }

  // Only take a paste when the pointer is over this panel, the grid is what is
  // showing, and nothing is being typed into: a paste aimed at the script
  // editor, at an open source, or at a text field must reach it untouched.
  #pasteWanted(e) {
    if (!this._hovered) return false;
    if (this._store.ui && this._store.ui.openDoc) return false;
    const path = e.composedPath();
    return !path.some((n) => n && n.tagName && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable));
  }

  async #onPaste(e) {
    if (!this.#pasteWanted(e)) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...(dt.files || [])];
    if (files.length) { e.preventDefault(); await this.#addFiles(files); return; }
    const url = normalizeUrl(dt.getData('text/plain'));
    if (url) { e.preventDefault(); this.#addUrl(url); }
  }

  #toggleLabel(label) {
    const key = normalizeLabel(label);
    const next = new Set(this._labels);
    if (next.has(key)) next.delete(key); else next.add(key);
    this._labels = next;
  }

  #clearFilters() {
    this._query = '';
    this._unlinkedOnly = false;
    this._labels = new Set();
  }

  // ---- rendering ----

  #tools(hasAny) {
    return html`
      ${hasAny ? html`
        <div class="find">
          ${icon('search')}
          <input type="text" placeholder="Find in sources" aria-label="Find in sources"
            .value=${this._query} @input=${(e) => { this._query = e.target.value; }}>
        </div>
        <pd-button variant=${this._unlinkedOnly ? 'dark' : 'default'}
          title="Show only the sources not yet linked to the script"
          @click=${() => { this._unlinkedOnly = !this._unlinkedOnly; }}>Unlinked</pd-button>
      ` : nothing}
      <pd-button icon title="Add files: images, video, audio, PDFs, anything" @click=${() => this.#upload()}>${icon('upload')}</pd-button>
    `;
  }

  // The topics in use, as a row of chips. Derived from the sources themselves
  // (allLabels), so it cannot list a topic nothing carries, and it is absent
  // entirely until something is labelled: an empty row of an unexplained
  // control is worse than no control.
  #topics(project) {
    const labels = allLabels(project.research);
    if (!labels.length) return nothing;
    return html`
      <div class="topics">
        ${labels.map((l) => html`<button class=${this._labels.has(l.label) ? 'on' : ''}
          title=${this._labels.has(l.label) ? 'Stop showing only ' + l.label : 'Show only ' + l.label}
          @click=${() => this.#toggleLabel(l.label)}>${l.label} <i>${l.count}</i></button>`)}
        ${this._labels.size ? html`<button class="clear" @click=${() => { this._labels = new Set(); }}>Clear</button>` : nothing}
      </div>
    `;
  }

  #newTile() {
    return html`
      <button class="newcard" @click=${() => this.#newSource()}>
        <span class="plus">+</span>
        <span class="nm">New source</span>
        <span class="how">write, drop a file,<br>or paste a link</span>
      </button>
    `;
  }

  #picking(linking) {
    if (!linking || linking.from !== 'script') return nothing;
    const q = ((linking.parts && linking.parts[0] && linking.parts[0].q) || '').slice(0, 60);
    return html`
      <div class="picking">
        <span>Pick the source for ${q ? html`"${q}"` : 'this passage'}: click a card to link the whole source, or open one and select a passage inside it.</span>
        <button @click=${() => this.#newSource()}>New source</button>
        <button @click=${() => this._store.store.setUI({ linking: null })}>Cancel</button>
      </div>
    `;
  }

  #empty() {
    return html`
      <div class="nores">
        <p>Anything you put here can back a passage of the script.</p>
        ${this.#newTile()}
      </div>
    `;
  }

  #noMatches() {
    return html`
      <div class="nores">
        <p>No source matches ${this._query ? html`"${this._query}"` : 'this filter'}.</p>
        <pd-button @click=${() => this.#clearFilters()}>Clear the filter</pd-button>
      </div>
    `;
  }

  #grid(project) {
    const counts = {};
    for (const l of project.links) counts[l.researchId] = (counts[l.researchId] || 0) + 1;
    const linked = new Set(Object.keys(counts));
    // Newest first. Insertion order put every new source at the foot of the
    // grid, below the fold on a full panel, so adding one looked like nothing
    // had happened.
    const shown = filterResearch(project.research, {
      query: this._query,
      unlinkedOnly: this._unlinkedOnly,
      labels: this._labels,
      linked,
    }).slice().reverse();
    const filtered = shown.length !== project.research.length;
    return html`
      ${filtered ? html`
        <div class="filterbar">
          <span>${shown.length} of ${project.research.length} sources${this._unlinkedOnly ? ', not yet linked' : ''}${this._labels.size ? ', in ' + [...this._labels].join(' or ') : ''}</span>
          <button @click=${() => this.#clearFilters()}>Show all</button>
        </div>` : nothing}
      ${shown.length ? html`
        <div id="researchList">
          ${this.#newTile()}
          ${shown.map((d) => html`<pandemonium-research-card .doc=${d} .linkCount=${counts[d.id] || 0}></pandemonium-research-card>`)}
        </div>` : this.#noMatches()}
    `;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    const openDoc = project.research.find((d) => d.id === ui.openDoc);
    const hasAny = project.research.length > 0;

    return html`
      <div class="shell" style="--pane-bg:var(--bg)"
        @dragover=${(e) => this.#onDragOver(e)}
        @dragleave=${(e) => this.#onDragLeave(e)}
        @drop=${(e) => this.#onDrop(e)}>
        <div class="chrome">
          ${this.#title()}
          <div class="tools">${openDoc ? nothing : this.#tools(hasAny)}</div>
        </div>
        ${openDoc ? nothing : this.#picking(ui.linking)}
        ${openDoc || !hasAny ? nothing : this.#topics(project)}
        <div class="pbody">
          ${openDoc
            ? html`<pandemonium-research-reader .doc=${openDoc}></pandemonium-research-reader>`
            : (hasAny ? this.#grid(project) : this.#empty())}
        </div>
        ${this._dragging ? html`<div class="dropzone">Drop to add as a source</div>` : nothing}
      </div>
      <input type="file" id="fileRes" multiple style="display:none" @change=${(e) => this.#onFilePicked(e)}>
    `;
  }

  #title() {
    return html`<pd-panel-picker current="research" .leafId=${this.leafId}></pd-panel-picker>`;
  }
}

customElements.define('pandemonium-research-panel', PandemoniumResearchPanel);

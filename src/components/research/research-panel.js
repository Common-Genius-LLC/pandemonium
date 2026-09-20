'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { panelStyles } from '../../styles/shared.js';
import { readFileAsDataURL, readFileAsText, isTextShaped } from '../../utils/files.js';
import { dispatch } from '../../utils/events.js';
import { browse, normalizeUrl, allLabels, normalizeLabel, addLabel, removeLabel, folderPath, folderCount, MAX_LABEL } from '../../data/research-doc.js';
import { icon } from './icons.js';
import { leaveRect } from '../../utils/motion.js';
import '../ui/button.js';
import '../ui/panel-picker.js';
import './research-card.js';
import './folder-card.js';
import { isRefDrag, applyDrop, openMoveMenu, hasMoveTargets } from './move-menu.js';
import { researchIdsInDraft } from '../../data/project-model.js';
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
    _folder: { state: true }, // the folder being looked at; null is the top level
    _newFolder: { state: true }, // a folder just made, which opens ready to be named
    _addingLabel: { state: true },
    _crumbOver: { state: true },
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
    /* Where you are, as a path; each step is also somewhere to drop something. */
    /* At the foot of the pane: a solid strip in the pane's own colour, so it
       reads as part of the panel and stays put while the grid scrolls above it. */
    .crumbs{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:6px 12px 8px;font-family:var(--sans);font-size:11px;background:var(--pane-bg,var(--bg))}
    .crumb{
      height:22px;padding:0 9px;border:0;border-radius:20px;cursor:pointer;font:inherit;color:var(--mut);background:transparent;
      max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      transition:background var(--dur-1) var(--ease-out),color var(--dur-1) var(--ease-out);
    }
    .crumb:hover{background:var(--panel);color:var(--ink)}
    .crumb.here{color:var(--ink);font-weight:500}
    .crumb.over{background:var(--res);color:#fff}
    .sep{color:var(--mut);opacity:.6}
    /* The header of the folder you are in. */
    .fhead{display:flex;align-items:center;gap:6px;padding:0 10px 2px}
    .fname{
      flex:1;min-width:0;height:auto;padding:2px 6px;font-family:var(--sans);font-size:15px;font-weight:500;color:var(--ink);
      background:transparent;border:0;border-radius:var(--r);outline:0;
    }
    .fname:hover,.fname:focus{background:var(--panel)}
    .fhead .more{
      width:24px;height:24px;flex:none;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:transparent;color:var(--mut);font-family:var(--sans);font-size:14px;line-height:1;
    }
    .fhead .more:hover{background:var(--panel);color:var(--ink)}
    .flabels{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:0 12px 10px}
    .tag{
      display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 4px 0 9px;
      font-family:var(--sans);font-size:11px;color:var(--ink);background:var(--panel);border-radius:20px;
    }
    .tag button{width:15px;height:15px;padding:0;border:0;border-radius:50%;cursor:pointer;background:none;color:var(--mut);font-family:var(--sans);font-size:9px;line-height:1}
    .tag button:hover{background:var(--ph);color:var(--ink)}
    .addtag{height:20px;padding:0 9px;font-family:var(--sans);font-size:11px;font-weight:500;color:var(--mut);background:none;border:0;border-radius:20px;cursor:pointer}
    .addtag:hover{background:var(--panel);color:var(--ink)}
    .taginput{height:20px;width:120px;padding:0 9px;font-size:11px;font-family:var(--sans);background:var(--field);color:var(--ink);border:1px solid var(--link);border-radius:20px;outline:0}
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
    @keyframes drop-in{from{opacity:0}}
    .dropzone{
      animation:drop-in var(--dur-1) var(--ease-out);
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
    this._folder = null;
    this._newFolder = null;
    this._addingLabel = false;
    this._crumbOver = undefined;
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

  willUpdate() {
    const project = this._store.project;
    const ui = this._store.ui;
    if (!project || !ui) return;
    const folders = project.folders || [];
    // A source opened from elsewhere (search, a link in the script) shows its
    // folder when it is closed, so closing lands where it lives.
    const doc = ui.openDoc && project.research.find((d) => d.id === ui.openDoc);
    if (doc && this._openSeen !== doc.id) {
      this._openSeen = doc.id;
      const f = doc.folderId && folders.some((x) => x.id === doc.folderId) ? doc.folderId : null;
      if (f !== this._folder) this._folder = f;
    }
    if (!ui.openDoc) this._openSeen = null;
    // A folder deleted (here or on another device) is not somewhere to stand.
    if (this._folder && !folders.some((x) => x.id === this._folder)) this._folder = null;
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
    store.addLink({ researchId: docId, sParts: linking.parts, rParts: null, scriptId: linking.scriptId });
    store.setUI({ linking: null });
    return true;
  }

  // A source is made and opened with the caret already in its notes. No dialog
  // asking for a title, a kind and a URL first: there is nothing to ask that
  // the writer would not rather just type, and an empty source shows its own
  // fields anyway.
  #newSource(e) {
    if (e && e.currentTarget) leaveRect('research-open', e.currentTarget.getBoundingClientRect());
    const store = this._store.store;
    const doc = store.addResearch({ folderId: this._folder });
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
        ? this._store.store.addResearch({ title: file.name, body: await readFileAsText(file), folderId: this._folder })
        : this._store.store.addResearch({
          title: file.name,
          folderId: this._folder,
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
    const doc = store.addResearch({ url, folderId: this._folder });
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
    if (this._store.ui && this._store.ui.refDraft) this._store.store.setUI({ refDraft: null });
  }

  // The draft the panel is limited to, when it is limited to one that exists.
  #draftFilter() {
    const project = this._store.project;
    const id = this._store.ui && this._store.ui.refDraft;
    return id && project ? project.scripts.find((x) => x.id === id) || null : null;
  }

  // On: limited to the draft the writer is in. "Linked in a draft" and
  // "Unlinked" would contradict each other, so turning one on turns the other off.
  #toggleDraft() {
    const store = this._store.store;
    if (this.#draftFilter()) { store.setUI({ refDraft: null }); return; }
    this._unlinkedOnly = false;
    store.setUI({ refDraft: store.activeScript().id });
  }

  #newFolder() {
    const f = this._store.store.addFolder({ parentId: this._folder });
    this._newFolder = f.id;
    // Handed over once: the card starts editing on its first render, and
    // this is cleared after, so a later re-render does not restart it.
    requestAnimationFrame(() => { if (this._newFolder === f.id) this._newFolder = null; });
  }

  #goto(id) {
    this._folder = id;
    this._addingLabel = false;
  }

  #crumbDrop(e, id) {
    if (!isRefDrag(e.dataTransfer)) return;
    e.preventDefault();
    this._crumbOver = undefined;
    applyDrop(this, this._store.store, e.dataTransfer, id);
  }

  #crumbOver_(e, id) {
    if (!isRefDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this._crumbOver !== id) this._crumbOver = id;
  }

  // Where you are, as a path you can climb: every step is also a place to drop
  // something, which is how a thing is filed back up a level.
  #crumbs(project, folder) {
    const path = folderPath(project.folders || [], this._folder);
    const crumb = (id, label, here) => html`<button class="crumb ${here ? 'here' : ''} ${this._crumbOver === id ? 'over' : ''}"
      @click=${() => this.#goto(id)}
      @dragover=${(e) => this.#crumbOver_(e, id)} @dragleave=${() => { this._crumbOver = undefined; }}
      @drop=${(e) => this.#crumbDrop(e, id)}>${label}</button>`;
    return html`<nav class="crumbs" data-clarity-mask="true" aria-label="Folder path">
      ${crumb(null, 'References', false)}
      ${path.map((f, i) => html`<span class="sep">&rsaquo;</span>${crumb(f.id, f.name || 'Untitled', i === path.length - 1)}`)}
    </nav>`;
  }

  // The path bar sits at the foot of the pane, where a location readout
  // belongs, and only while you are inside a folder and looking at that
  // folder's own contents (a search or filter shows matches from every folder,
  // so there is no single place to be).
  #pathBar(project) {
    const folders = project.folders || [];
    const here = this._folder && folders.find((f) => f.id === this._folder);
    const searching = !!(this._query.trim() || this._labels.size || this._unlinkedOnly || this.#draftFilter());
    return here && !searching ? this.#crumbs(project, here) : nothing;
  }

  // The header of the folder you are in: its name, its labels, its menu.
  #folderHeader(project, folder) {
    const store = this._store.store;
    const known = allLabels([...(project.folders || []), ...project.research]).map((l) => l.label)
      .filter((l) => !(folder.labels || []).some((x) => x.toLowerCase() === l.toLowerCase()));
    const commitLabel = (text) => {
      const next = addLabel(folder.labels, text);
      if (next !== (folder.labels || [])) store.updateFolder(folder.id, { labels: next });
      this._addingLabel = false;
    };
    const n = folderCount(project.research, project.folders, folder.id);
    const item = { kind: 'folder', id: folder.id };
    return html`
      <div class="fhead" data-clarity-mask="true">
        <input class="fname" type="text" maxlength="60" placeholder="Untitled folder" .value=${folder.name || ''}
          @change=${(e) => { const v = e.target.value.trim(); if (v) store.updateFolder(folder.id, { name: v }); else e.target.value = folder.name || ''; }}
          @keydown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}>
        <button class="more" title="Folder options" @click=${(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items: [
            ...(hasMoveTargets(store, item) ? [{ label: 'Move to folder...', fn: () => openMoveMenu(this, store, item, { x: r.left, y: r.bottom + 4 }) }] : []),
            { label: 'Delete folder', danger: true, fn: () => {
              if (confirm('Delete the folder "' + (folder.name || 'Untitled') + '"?' + (n ? ' Its ' + n + ' item' + (n === 1 ? '' : 's') + ' move up a level, nothing else is deleted.' : ''))) {
                const up = folder.parentId || null;
                store.deleteFolder(folder.id);
                this._folder = up;
              }
            } },
          ] });
        }}>&#8943;</button>
      </div>
      <div class="flabels" data-clarity-mask="true">
        ${(folder.labels || []).map((l) => html`<span class="tag">${l}<button title="Remove this label" @click=${() => store.updateFolder(folder.id, { labels: removeLabel(folder.labels, l) })}>&#10005;</button></span>`)}
        ${this._addingLabel
          ? html`<input class="taginput" list="fl" maxlength=${MAX_LABEL} placeholder="Topic name"
              @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLabel(e.target.value); } if (e.key === 'Escape') { e.stopPropagation(); this._addingLabel = false; } }}
              @blur=${(e) => commitLabel(e.target.value)}>
            <datalist id="fl">${known.map((l) => html`<option value=${l}></option>`)}</datalist>`
          : html`<button class="addtag" title="Group this folder under a topic" @click=${() => {
            this._addingLabel = true;
            this.updateComplete.then(() => { const el = this.renderRoot.querySelector('.taginput'); if (el) el.focus(); });
          }}>+ Label</button>`}
      </div>
    `;
  }

  // ---- rendering ----

  #tools(hasAny) {
    return html`
      ${hasAny ? html`
        <div class="find" data-clarity-mask="true">
          ${icon('search')}
          <input type="text" placeholder="Find in sources" aria-label="Find in sources"
            .value=${this._query} @input=${(e) => { this._query = e.target.value; }}>
        </div>
        <pd-button variant=${this.#draftFilter() ? 'dark' : 'default'}
          title=${this.#draftFilter() ? 'Showing only the references linked in this draft. Click to show all.' : 'Show only the references linked in the draft you are in'}
          @click=${() => this.#toggleDraft()}>This draft</pd-button>
        <pd-button variant=${this._unlinkedOnly ? 'dark' : 'default'}
          title="Show only the sources not yet linked to the script"
          @click=${() => { this._unlinkedOnly = !this._unlinkedOnly; if (this._unlinkedOnly) this._store.store.setUI({ refDraft: null }); }}>Unlinked</pd-button>
      ` : nothing}
      <pd-button icon title="New folder" @click=${() => this.#newFolder()}>${icon('folderAdd')}</pd-button>
      <pd-button icon title="Add files: images, video, audio, PDFs, anything" @click=${() => this.#upload()}>${icon('upload')}</pd-button>
    `;
  }

  // The topics in use, as a row of chips. Derived from the sources themselves
  // (allLabels), so it cannot list a topic nothing carries, and it is absent
  // entirely until something is labelled: an empty row of an unexplained
  // control is worse than no control.
  #topics(project) {
    const labels = allLabels([...(project.folders || []), ...project.research]);
    if (!labels.length) return nothing;
    return html`
      <div class="topics" data-clarity-mask="true">
        ${labels.map((l) => html`<button class=${this._labels.has(l.label) ? 'on' : ''}
          title=${this._labels.has(l.label) ? 'Stop showing only ' + l.label : 'Show only ' + l.label}
          @click=${() => this.#toggleLabel(l.label)}>${l.label} <i>${l.count}</i></button>`)}
        ${this._labels.size ? html`<button class="clear" @click=${() => { this._labels = new Set(); }}>Clear</button>` : nothing}
      </div>
    `;
  }

  #newTile() {
    return html`
      <button class="newcard" @click=${(e) => this.#newSource(e)}>
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
      <div class="picking" data-clarity-mask="true">
        <span>Pick the source for ${q ? html`"${q}"` : 'this passage'}: click a card to link the whole source, or open one and select a passage inside it.</span>
        <button @click=${(e) => this.#newSource(e)}>New source</button>
        <button @click=${() => this._store.store.setUI({ linking: null })}>Cancel</button>
      </div>
    `;
  }

  #empty() {
    return html`
      <div class="nores">
        <p>Anything you put here can back a passage of the script.</p>
        ${this.#newTile()}
        <pd-button @click=${() => this.#newFolder()}>New folder</pd-button>
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
    const folders = project.folders || [];
    // One folder's contents, or (while searching, or a topic or the unlinked
    // filter is on) every match across all folders at once. Newest first, so
    // adding something is never below the fold.
    const draft = this.#draftFilter();
    const ids = draft ? researchIdsInDraft(project, draft.id, this._store.store.finalScript().id) : null;
    const view = browse({ research: project.research, folders, folderId: this._folder, query: this._query, unlinkedOnly: this._unlinkedOnly, labels: this._labels, linked, ids });
    const here = view.here ? folders.find((f) => f.id === view.here) : null;
    const empty = !view.docs.length && !view.folders.length;
    return html`
      ${here && !view.flat ? this.#folderHeader(project, here) : nothing}
      ${view.flat ? html`
        <div class="filterbar">
          <span>${view.docs.length} of ${project.research.length} sources${view.folders.length ? ', ' + view.folders.length + ' folder' + (view.folders.length === 1 ? '' : 's') : ''}${this._unlinkedOnly ? ', not yet linked' : ''}${draft ? ', linked in ' + draft.name : ''}${this._labels.size ? ', in ' + [...this._labels].join(' or ') : ''}, across every folder</span>
          <button @click=${() => this.#clearFilters()}>Show all</button>
        </div>` : nothing}
      ${view.flat && empty ? this.#noMatches() : html`
        <div id="researchList">
          ${view.flat ? nothing : this.#newTile()}
          ${view.folders.map((f) => html`<pandemonium-folder-card .folder=${f}
            .count=${folderCount(project.research, folders, f.id)} .autoEdit=${f.id === this._newFolder}></pandemonium-folder-card>`)}
          ${view.docs.map((d) => html`<pandemonium-research-card .doc=${d} .linkCount=${counts[d.id] || 0}></pandemonium-research-card>`)}
        </div>`}
    `;
  }

  render() {
    const project = this._store.project;
    if (!project) return html``;
    const ui = this._store.ui;
    const openDoc = project.research.find((d) => d.id === ui.openDoc);
    const hasAny = project.research.length > 0 || (project.folders || []).length > 0;

    return html`
      <div class="shell" style="--pane-bg:var(--bg)"
        @pandemonium-open-folder=${(e) => this.#goto(e.detail.id)}
        @dragover=${(e) => this.#onDragOver(e)}
        @dragleave=${(e) => this.#onDragLeave(e)}
        @drop=${(e) => this.#onDrop(e)}>
        <div class="chrome">
          ${this.#title()}
          <div class="tools">${openDoc ? nothing : this.#tools(hasAny)}</div>
        </div>
        ${openDoc ? nothing : this.#picking(ui.linking)}
        ${openDoc || !hasAny ? nothing : this.#topics(project)}
        <div class="pbody" data-clarity-mask="true">
          ${openDoc
            ? html`<pandemonium-research-reader .doc=${openDoc}></pandemonium-research-reader>`
            : (hasAny ? this.#grid(project) : this.#empty())}
        </div>
        ${openDoc ? nothing : this.#pathBar(project)}
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

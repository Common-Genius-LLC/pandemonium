'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { dispatch } from '../../utils/events.js';
import { openPair } from '../../state/actions.js';
import { NOTE_COLORS, colorToken, docTitle, docSnippet, hostOf, mediaKind } from '../../data/research-doc.js';
import { previewOf, optimizeImage } from '../../data/link-preview.js';
import { mediaIcon } from './icons.js';
import { withGlobalItems } from '../../utils/context-menu.js';

// One research source in the grid. A source is one record that may carry a
// piece of media, a URL and notes in any combination, so the card shows
// whichever of those exist rather than being one of three card types:
//   - a thumbnail when the media is an image (a video, audio file or PDF gets
//     its glyph on a plain tile, since there is no still to show)
//   - the title (the page's own, for a link the writer did not name)
//   - the notes, or failing that the URL, as the preview line
//   - the host, and how many script passages this source backs
//
// The card takes the source's colour as its fill. Colours are for the writer's
// own sorting (this one is costume, that one is location), which is why they
// are a free choice on any source and not tied to what the source is.
export class PandemoniumResearchCard extends LitElement {
  static properties = { doc: { type: Object }, linkCount: { type: Number } };

  static styles = css`
    :host{display:block}
    .rcard{
      position:relative;background:var(--card,var(--note-plain));border-radius:12.36px;overflow:hidden;
      min-height:112px;display:flex;flex-direction:column;cursor:pointer;
    }
    /* Hover is a wash rather than a second fill per colour: --row-hover already
       flips with the theme, so one rule covers six colours in both themes. */
    .rcard::after{content:"";position:absolute;inset:0;background:transparent;pointer-events:none;transition:background .12s}
    .rcard:hover::after{background:var(--row-hover)}
    .thumb{aspect-ratio:16/9;background:var(--ph);display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden}
    .thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .thumb svg{width:26px;height:26px;fill:var(--mut)}
    /* A still with a play badge reads as a video without a word of copy. */
    .thumb{position:relative}
    .playdot{
      position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:10px;padding-left:2px;box-sizing:border-box;
    }
    .text{padding:10px;display:flex;flex-direction:column;gap:6px;flex:1;min-height:0}
    .rt{font-size:12px;font-weight:500;color:var(--ink);display:flex;gap:6px;align-items:flex-start;line-height:1.35}
    .rt span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
    .snip{color:var(--mut);font-size:11px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex:1;overflow-wrap:anywhere}
    /* Topics, under the preview line. Clicking one filters the grid to it,
       which is the whole of what organising by topic has to mean. */
    .tags{display:flex;flex-wrap:wrap;gap:4px}
    .tags button{
      height:17px;padding:0 7px;font-family:var(--sans);font-size:10px;color:var(--ui);
      background:var(--bg);border:0;border-radius:20px;cursor:pointer;max-width:100%;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    .tags button:hover{background:var(--overlay);color:var(--overlay-ink)}
    .foot{display:flex;align-items:center;gap:8px;font-size:10px;min-height:14px}
    .host{color:var(--link);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    /* The link count is the way back to the script, not a statistic: clicking
       it opens the passage this source backs. */
    .links{margin-left:auto;flex:none;color:var(--res);font-weight:500;background:none;border:0;padding:0;cursor:pointer;font-family:var(--sans);font-size:10px}
    .links:hover{text-decoration:underline}
    /* Overflow menu, top right, on hover. */
    .more{
      position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border:0;border-radius:50%;cursor:pointer;
      background:var(--overlay);color:var(--overlay-ink);font-family:var(--sans);font-size:13px;line-height:1;
      opacity:0;transition:opacity .12s;pointer-events:none;
    }
    .rcard:hover .more,.more:focus-visible{opacity:1;pointer-events:auto}
    /* While the script is waiting for a source to be picked, every card is a
       target and says so, the way an unlinked storyboard frame does. */
    :host([data-linking]) .rcard{outline:2px solid var(--res);outline-offset:-2px}
    .linkhere{
      position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.35);opacity:0;transition:opacity .12s;pointer-events:none;
    }
    :host([data-linking]) .rcard:hover .linkhere{opacity:1}
    .linkhere b{
      font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;padding:6px 10px;border-radius:20px;
      background:var(--res);color:#fff;
    }
  `;

  constructor() {
    super();
    this._store = new StoreController(this);
  }

  #linking() {
    const ui = this._store.ui;
    return !!(ui && ui.linking && ui.linking.from === 'script');
  }

  updated() {
    // An attribute rather than a class so the outline rule can hang off :host
    // and cover the whole card including its thumbnail.
    if (this.#linking()) this.setAttribute('data-linking', '');
    else this.removeAttribute('data-linking');
  }

  #click() {
    const store = this._store.store;
    const ui = store.ui;
    if (ui.linking && ui.linking.from === 'script') {
      store.addLink({ researchId: this.doc.id, sParts: ui.linking.parts, rParts: null });
      // Clearing ui.linking is all the linkbar needs: it derives its own
      // visibility from that state, so there is nothing to tell it to hide.
      store.setUI({ linking: null });
      dispatch(this, 'pandemonium-toast', { message: 'Linked to the whole source. Open it and select a passage to narrow the link.' });
      return;
    }
    store.setUI({ openDoc: this.doc.id });
  }

  // Jump to the first script passage this source backs, which is also what
  // opens the connector between the two.
  #goToScript(e) {
    e.stopPropagation();
    const store = this._store.store;
    const link = store.project.links.find((l) => l.researchId === this.doc.id);
    if (link) openPair(store, link.id);
  }

  // Filtering the grid is the panel's business, not the card's, so the card
  // reports the chip that was clicked and lets the panel decide.
  #pickLabel(e, label) {
    e.stopPropagation();
    dispatch(this, 'pandemonium-pick-label', { label });
  }

  #menuItems() {
    const store = this._store.store;
    const d = this.doc;
    // No "Open": clicking the card is what opens it, and a menu item for the
    // thing the object already does on a plain click is a row that can only
    // ever be read and skipped.
    return [
      {
        swatches: NOTE_COLORS.map((c) => ({
          label: c.label,
          color: c.dot,
          selected: (d.color || null) === c.key,
          fn: () => store.updateResearch(d.id, { color: c.key }),
        })),
      },
      { divider: true },
      { label: 'Delete source', danger: true, fn: () => this.#delete() },
    ];
  }

  #menu(e) {
    e.stopPropagation();
    dispatch(this, 'pandemonium-open-menu', { anchor: e.currentTarget, items: this.#menuItems() });
  }

  // Right-click reaches the same menu, which is where anyone coming from any
  // other tool will look for it first. Stopping propagation keeps the pane's
  // own leaf menu (panel-layout.js) from answering instead, the same
  // most-specific-handler-wins rule that file documents; the global items ride
  // along because this is now the menu for this spot.
  #contextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch(this, 'pandemonium-open-menu', {
      x: e.clientX, y: e.clientY, items: withGlobalItems(this, this.#menuItems()),
    });
  }

  #delete() {
    const d = this.doc;
    const n = this.linkCount || 0;
    const warn = n ? ' and its ' + n + ' link' + (n === 1 ? '' : 's') + ' to the script' : '';
    if (!confirm('Delete "' + docTitle(d) + '"' + warn + '?')) return;
    this._store.store.deleteResearch(d.id);
    dispatch(this, 'pandemonium-toast', { message: 'Source deleted.' });
  }

  // An image gets a real thumbnail; other media get their glyph on a plain
  // tile. A source with no media has no tile at all, so a wall of notes stays
  // a wall of notes rather than a wall of empty frames.
  //
  // loading="lazy" so a grid scrolled past does not go and get forty of them,
  // and no referrer, because many image hosts refuse a hotlink by Referer and
  // the page the writer is on is nobody else's business.
  #thumb() {
    const att = this.doc.attachment;
    if (att && att.data) {
      if (mediaKind(att) === 'image') return html`<div class="thumb"><img alt="" src=${att.data}></div>`;
      return html`<div class="thumb">${mediaIcon(att)}</div>`;
    }
    // The server's image when the source has been read (stored on it, so the
    // grid draws offline and never fans out one request per card), else what
    // the URL alone can promise (a video's own still, an image link).
    const url = this.doc.url;
    const local = url ? previewOf(url) : null;
    const stored = this.doc.preview && this.doc.preview.url === url ? this.doc.preview : null;
    const found = (stored && stored.image) || (local && local.thumb);
    const src = found ? optimizeImage(found, 400) : null;
    if (src) {
      return html`<div class="thumb">
        <img alt="" src=${src} loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${(e) => { e.target.remove(); }}>
        ${local && local.embed ? html`<span class="playdot">&#9654;</span>` : nothing}
      </div>`;
    }
    return nothing;
  }

  render() {
    const d = this.doc;
    const title = docTitle(d);
    const host = hostOf(d.url || '');
    // The host goes in the foot only when it is not already the headline: an
    // untitled link is NAMED by its host, and printing it twice says nothing
    // the second time. Its preview line carries the full URL, which does.
    const showHost = host && title !== host;
    const snip = docSnippet(d);
    const n = this.linkCount || 0;
    return html`
      <div class="rcard" style="--card:${colorToken(d.color)}"
        @click=${() => this.#click()} @contextmenu=${(e) => this.#contextMenu(e)}>
        ${this.#thumb()}
        <button class="more" title="Source options" @click=${(e) => this.#menu(e)}>&#8943;</button>
        <div class="text">
          <div class="rt"><span>${title}</span></div>
          <div class="snip">${snip}</div>
          ${(d.labels || []).length ? html`<div class="tags">
            ${(d.labels || []).map((l) => html`<button title=${'Show only ' + l} @click=${(e) => this.#pickLabel(e, l)}>${l}</button>`)}
          </div>` : nothing}
          <div class="foot">
            ${showHost ? html`<span class="host" title=${d.url}>${host}</span>` : nothing}
            ${n ? html`<button class="links" title="Go to the script passage this backs" @click=${(e) => this.#goToScript(e)}>${n} in script</button>` : nothing}
          </div>
        </div>
        <div class="linkhere"><b>Link this source</b></div>
      </div>
    `;
  }
}

customElements.define('pandemonium-research-card', PandemoniumResearchCard);

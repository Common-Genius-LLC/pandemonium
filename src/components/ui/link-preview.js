'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { fetchLinkPreview, peekLinkPreview } from '../../data/link-preview-client.js';
import { previewOf, isRichPreview, cardLayout, previewMeta, optimizeImage } from '../../data/link-preview.js';
import { fadeIn } from '../../utils/motion.js';

// <pd-link-preview url="..."> : a link drawn as a social card, the way Slack or
// Twitter unfurl one, from the server's Open Graph read of the page.
//
//   loading  a pulsing skeleton the exact shape of the card it becomes, so the
//            layout does not jump when the data lands
//   error    a plain clickable link (or nothing, with `quiet`, for a caller
//            that already shows the URL). The endpoint unreachable, the page
//            blocked, a page with nothing worth a card: all degrade to the
//            thing the writer pasted, which always works
//   loaded   one of three shapes, chosen the way Twitter and Slack choose:
//              large  the image as a frame, 1.91:1 (Open Graph's own ratio)
//                     on top when narrow and beside the text when the card is
//                     wide (a container query, so it follows the card's width
//                     and not the window's)
//              small  a square thumbnail beside the text, for a square or
//                     small image (an album cover, a logo) that a wide crop
//                     would cut in half
//              text   no image at all
//
// Under the title sits one line of what the thing IS when the page said so
// (a song's artist and length, a video's channel, an article's byline), and
// the site's own icon sits beside its domain. Title and domain are one line
// each and the description at most two, so a card is always the same height
// whatever the page puts in its tags. Images go through optimizeImage, which
// asks a resizing CDN for a card-sized rendition instead of the full 4K file.
//
// A video or a Spotify link plays in place, and only when asked: a click on the
// play badge loads the player. Adding a link never quietly pulls another
// site's player, scripts and cookies into the page.
//
// `.data` hands in a preview the caller already has (a research source keeps
// one), which draws at once; the request still goes out to refresh it. Every
// successful load fires `pd-link-preview-load` with the preview.
export class PdLinkPreview extends LitElement {
  static properties = {
    url: { type: String },
    data: { type: Object },
    quiet: { type: Boolean },
    _state: { state: true }, // 'loading' | 'ready' | 'error'
    _preview: { state: true },
    _imgFailed: { state: true },
    _iconFailed: { state: true },
    _playing: { state: true },
  };

  static styles = css`
    :host{display:block;container-type:inline-size;font-family:var(--sans)}
    .card{
      display:grid;grid-template-columns:1fr;background:var(--bg);border-radius:12.36px;overflow:hidden;
      color:var(--ink);text-decoration:none;
    }
    .card.small{grid-template-columns:88px 1fr}
    .card.small .media{aspect-ratio:1/1;height:100%;min-height:88px}
    /* Wide enough for the large image to sit beside the text: the Slack and
       Discord shape, which keeps a card short in a wide pane. */
    @container (min-width: 460px){
      .card.large{grid-template-columns:minmax(150px,36%) 1fr}
      .card.large .media{aspect-ratio:auto;min-height:118px;height:100%}
      .card.small{grid-template-columns:104px 1fr}
    }
    .media{position:relative;display:block;aspect-ratio:1.91/1;background:var(--ph);overflow:hidden}
    /* object-fit:cover crops to fill without ever stretching: a portrait
       poster and a wide banner both become a clean frame. */
    .media img{width:100%;height:100%;object-fit:cover;display:block}
    .text{display:flex;flex-direction:column;gap:3px;padding:10px 12px 12px;min-width:0;justify-content:center}
    a.text{color:inherit;text-decoration:none}
    .card:hover .title{text-decoration:underline}
    .site{display:flex;align-items:center;gap:6px;min-width:0}
    .site img{width:14px;height:14px;flex:none;border-radius:3px}
    /* One line for the domain, the title and the byline, two for the
       description: the whole point of a card is that it scans at a glance. */
    .domain,.title,.meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .domain{font-size:11px;color:var(--mut)}
    .title{font-size:13px;font-weight:500;line-height:1.35}
    .meta{font-size:11px;color:var(--ui)}
    .desc{
      font-size:12px;line-height:1.45;color:var(--mut);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;
    }
    .play{
      position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      background:none;border:0;padding:0;cursor:pointer;width:100%;
    }
    .play span{
      width:42px;height:42px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:14px;padding-left:3px;box-sizing:border-box;
    }
    .card.small .play span{width:34px;height:34px;font-size:12px}
    .play:hover span,.play:focus-visible span{background:var(--res)}
    .player{display:block;width:100%;border:0;background:var(--ph)}
    .player.video{aspect-ratio:16/9}

    /* Skeleton: the card's own shape in placeholder grey, breathing. */
    .skel .media,.skel .bar{background:var(--ph);animation:breathe 1.3s ease-in-out infinite}
    .bar{height:10px;border-radius:5px}
    .bar.d{width:30%}
    .bar.t{width:78%;height:13px}
    .bar.x{width:92%}
    .bar.y{width:60%}
    @keyframes breathe{50%{opacity:.45}}
    @media (prefers-reduced-motion: reduce){ .skel .media,.skel .bar{animation:none} }

    a.plain{
      display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font-size:12px;color:var(--link);text-decoration:none;padding:2px 0;
    }
    a.plain:hover{text-decoration:underline}
  `;

  constructor() {
    super();
    this._state = 'loading';
    this._preview = null;
    this._imgFailed = false;
    this._iconFailed = false;
    this._playing = false;
    this._loadedFor = null;
  }

  willUpdate(changed) {
    if (!changed.has('url') && !changed.has('data')) return;
    // What can be drawn right now: a stored preview for this URL, or one this
    // session already fetched. Either way the refresh below still happens.
    const d = this.data;
    const known = (d && d.url === this.url && (d.title || d.description || d.image)) ? d : peekLinkPreview(this.url);
    if (known && (known.sources ? isRichPreview(known) : true)) {
      this._preview = known;
      this._state = 'ready';
    }
    if (changed.has('url')) {
      this._imgFailed = false;
      this._iconFailed = false;
      this._playing = false;
      this.#load();
    }
  }

  async #load() {
    const url = this.url;
    if (!url) { this._state = 'error'; return; }
    if (this._state !== 'ready') this._state = 'loading';
    this._loadedFor = url;
    try {
      const p = await fetchLinkPreview(url);
      if (this._loadedFor !== url) return; // the url changed while we waited
      if (!isRichPreview(p)) { if (this._state !== 'ready') this._state = 'error'; return; }
      const fromSkeleton = this._state === 'loading';
      this._preview = p;
      this._state = 'ready';
      if (fromSkeleton) this.updateComplete.then(() => fadeIn(this.renderRoot.querySelector('.card'), { rise: 2 }));
      this.dispatchEvent(new CustomEvent('pd-link-preview-load', { detail: { preview: p }, bubbles: true, composed: true }));
    } catch {
      // Whatever was drawn from stored data stays; with nothing to draw, a link.
      if (this._loadedFor === url && this._state !== 'ready') this._state = 'error';
    }
  }

  #skeleton() {
    return html`
      <div class="card large skel" aria-busy="true" aria-label="Loading link preview">
        <div class="media"></div>
        <div class="text"><div class="bar d"></div><div class="bar t"></div><div class="bar x"></div><div class="bar y"></div></div>
      </div>
    `;
  }

  #media(p, embed, layout) {
    const img = html`<img alt=${p.imageAlt || ''} src=${optimizeImage(p.image, layout === 'small' ? 240 : 720)}
      loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${() => { this._imgFailed = true; }}>`;
    if (embed) {
      return html`<div class="media">${img}
        <button class="play" title="Play here (loads the player)" aria-label="Play" @click=${() => { this._playing = true; }}><span>&#9654;</span></button>
      </div>`;
    }
    return html`<a class="media" href=${this.url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${img}</a>`;
  }

  // The player replaces the image once asked for; the title stays under it,
  // still a link to the page.
  #player(p, local) {
    const video = !local.embedHeight;
    return html`<iframe class="player ${video ? 'video' : ''}" style=${video ? '' : `height:${local.embedHeight}px`}
      src=${local.embed + (local.embed.includes('?') ? '&' : '?') + 'autoplay=1'}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title=${p.title || 'Player'}></iframe>`;
  }

  render() {
    if (this._state === 'loading') return this.#skeleton();
    const url = this.url || '';
    if (this._state === 'error' || !this._preview) {
      if (this.quiet) return nothing;
      return html`<a class="plain" href=${url} target="_blank" rel="noopener noreferrer" title=${url}>${url.replace(/^https?:\/\/(www\.)?/, '')}</a>`;
    }
    const p = this._preview;
    const local = previewOf(url) || {};
    const embed = local.embed || null;
    const layout = !p.image || this._imgFailed ? 'text' : (p.layout || cardLayout(p));
    const meta = p.meta !== undefined ? p.meta : previewMeta(p);
    const text = html`
      <a class="text" href=${url} target="_blank" rel="noopener noreferrer">
        <span class="site">
          ${p.favicon && !this._iconFailed ? html`<img alt="" src=${p.favicon} referrerpolicy="no-referrer" @error=${() => { this._iconFailed = true; }}>` : nothing}
          <span class="domain">${p.domain}</span>
        </span>
        <span class="title">${p.title || url}</span>
        ${meta ? html`<span class="meta">${meta}</span>` : nothing}
        ${p.description ? html`<span class="desc">${p.description}</span>` : nothing}
      </a>
    `;
    if (this._playing && embed) {
      return html`<div class="card">${this.#player(p, local)}${text}</div>`;
    }
    return html`
      <div class="card ${layout}">
        ${layout === 'text' ? nothing : this.#media(p, embed, layout)}
        ${text}
      </div>
    `;
  }
}

customElements.define('pd-link-preview', PdLinkPreview);

'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { fetchLinkPreview } from '../../data/link-preview-client.js';
import { previewOf, isRichPreview } from '../../data/link-preview.js';

// <pd-link-preview url="..."> : a link drawn as a social card, the way Slack or
// Twitter unfurl one, from the server's Open Graph read of the page
// (GET /v1/link-preview).
//
//   loading  a pulsing skeleton the exact shape of the card it becomes, so the
//            layout does not jump when the data lands
//   error    a plain clickable link. The API unreachable, the page blocked, a
//            page with nothing in it worth a card: all of these degrade to the
//            thing the writer pasted, which always works
//   loaded   domain, title and description beside or under the image
//
// Layout follows the width of the CARD, not the window (a container query):
// in a narrow pane the image sits on top at the Open Graph 1.91:1 ratio, and
// once the card is wide enough it moves to the left, as a Slack unfurl does.
// Title and domain are one line each and the description at most two, so a
// card is always the same height whatever the page puts in its tags.
//
// `quiet` renders nothing at all in the error state, for a caller that
// already shows the URL itself.
//
// Optional `.data` hands in a preview the caller already has (a research
// source keeps one), which draws immediately and skips the request. Every
// successful load fires `pd-link-preview-load` with the preview, so a caller
// can keep it.
export class PdLinkPreview extends LitElement {
  static properties = {
    url: { type: String },
    data: { type: Object },
    // With nothing rich to show, render nothing rather than a plain link: for
    // a caller that already shows the URL itself (the research link box).
    quiet: { type: Boolean },
    _state: { state: true }, // 'loading' | 'ready' | 'error'
    _preview: { state: true },
    _imgFailed: { state: true },
    _playing: { state: true },
  };

  static styles = css`
    :host{display:block;container-type:inline-size;font-family:var(--sans)}
    .card{
      display:grid;grid-template-columns:1fr;background:var(--bg);border-radius:12.36px;overflow:hidden;
      color:var(--ink);text-decoration:none;
    }
    /* Wide enough for the image to sit beside the text: the Slack/Discord
       shape, which keeps a card short in a wide pane instead of a tall poster. */
    @container (min-width: 460px){
      .card{grid-template-columns:minmax(150px,36%) 1fr}
      .card.noimg{grid-template-columns:1fr}
      .media{aspect-ratio:auto;min-height:118px;height:100%}
    }
    .media{position:relative;display:block;aspect-ratio:1.91/1;background:var(--ph);overflow:hidden}
    /* object-fit:cover crops to fill without ever stretching: a portrait
       poster and a wide banner both become a clean frame. */
    .media img{width:100%;height:100%;object-fit:cover;display:block}
    .media iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .text{display:flex;flex-direction:column;gap:3px;padding:10px 12px 12px;min-width:0;justify-content:center}
    a.text{color:inherit;text-decoration:none}
    .card:hover .title{text-decoration:underline}
    /* One line for the domain and the title, two for the description: the
       whole point of a card is that it scans in a glance. */
    .domain,.title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .domain{font-size:11px;color:var(--mut)}
    .title{font-size:13px;font-weight:500;line-height:1.35}
    .desc{
      font-size:12px;line-height:1.45;color:var(--mut);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;
    }
    .play{
      position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      background:none;border:0;padding:0;cursor:pointer;width:100%;
    }
    .play span{
      width:46px;height:46px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:15px;padding-left:3px;box-sizing:border-box;
    }
    .play:hover span,.play:focus-visible span{background:var(--res)}

    /* Skeleton: the card's own shape in placeholder grey, breathing. */
    .skel .media,.skel .bar{background:var(--ph);animation:breathe 1.3s ease-in-out infinite}
    .bar{height:10px;border-radius:5px}
    .bar.d{width:30%}
    .bar.t{width:78%;height:13px}
    .bar.x{width:92%}
    .bar.y{width:60%}
    @keyframes breathe{50%{opacity:.45}}
    @media (prefers-reduced-motion: reduce){ .skel .media,.skel .bar{animation:none} }

    /* The error state is a link and nothing more. */
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
    this._playing = false;
    this._loadedFor = null;
  }

  willUpdate(changed) {
    if (!changed.has('url') && !changed.has('data')) return;
    // Data handed in for this URL draws at once (a stored preview, see
    // storablePreview), and the request still goes out to refresh it; a
    // different URL starts over.
    const d = this.data;
    if (d && d.url === this.url && (d.title || d.description || d.image)) {
      this._preview = d;
      this._state = 'ready';
    }
    if (changed.has('url')) {
      this._imgFailed = false;
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
      this._preview = p;
      this._state = 'ready';
      this.dispatchEvent(new CustomEvent('pd-link-preview-load', { detail: { preview: p }, bubbles: true, composed: true }));
    } catch {
      // Whatever was drawn from `.data` stays; with nothing to draw, a link.
      if (this._loadedFor === url && this._state !== 'ready') this._state = 'error';
    }
  }

  #skeleton() {
    return html`
      <div class="card skel" aria-busy="true" aria-label="Loading link preview">
        <div class="media"></div>
        <div class="text"><div class="bar d"></div><div class="bar t"></div><div class="bar x"></div><div class="bar y"></div></div>
      </div>
    `;
  }

  #media(p, embed) {
    if (this._playing && embed) {
      return html`<div class="media"><iframe src=${embed + '?autoplay=1'} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title=${p.title || 'Video'}></iframe></div>`;
    }
    const img = html`<img alt="" src=${p.image} loading="lazy" decoding="async"
      referrerpolicy="no-referrer" @error=${() => { this._imgFailed = true; }}>`;
    // A video plays in place, and only when asked: adding a link must never
    // quietly load another site's player, scripts and cookies.
    if (embed) {
      return html`<div class="media">${img}
        <button class="play" title="Play here (loads the player)" aria-label="Play video" @click=${() => { this._playing = true; }}><span>&#9654;</span></button>
      </div>`;
    }
    return html`<a class="media" href=${this.url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${img}</a>`;
  }

  render() {
    if (this._state === 'loading') return this.#skeleton();
    const url = this.url || '';
    if (this._state === 'error' || !this._preview) {
      if (this.quiet) return nothing;
      return html`<a class="plain" href=${url} target="_blank" rel="noopener noreferrer" title=${url}>${url.replace(/^https?:\/\/(www\.)?/, '')}</a>`;
    }
    const p = this._preview;
    const showImage = p.image && !this._imgFailed;
    const embed = (previewOf(url) || {}).embed || null;
    return html`
      <div class="card ${showImage ? '' : 'noimg'}">
        ${showImage ? this.#media(p, embed) : nothing}
        <a class="text" href=${url} target="_blank" rel="noopener noreferrer">
          <span class="domain">${p.domain}</span>
          <span class="title">${p.title || url}</span>
          ${p.description ? html`<span class="desc">${p.description}</span>` : nothing}
        </a>
      </div>
    `;
  }
}

customElements.define('pd-link-preview', PdLinkPreview);

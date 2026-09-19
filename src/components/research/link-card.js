'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { previewOf, previewLabel } from '../../data/link-preview.js';

// The preview for a source whose material is a page rather than an uploaded
// file. What it can show is decided entirely by the URL (see data/link-preview.js
// for why nothing is fetched to find out more).
//
// A video is NOT loaded until it is asked for. The poster is a still the
// origin already serves; clicking it swaps in the player. Adding a link should
// never quietly pull another site's player, scripts and cookies into the page,
// and a grid of twenty reference clips should not start twenty players.
export class PandemoniumLinkCard extends LitElement {
  static properties = { url: { type: String }, _playing: { state: true } };

  static styles = css`
    :host{display:block}
    a.wrap{display:block;text-decoration:none;color:inherit}
    .frame{position:relative;aspect-ratio:16/9;background:var(--ph);border-radius:12.36px;overflow:hidden;cursor:pointer}
    .frame img{width:100%;height:100%;object-fit:cover;display:block}
    .frame iframe{width:100%;height:100%;border:0;display:block}
    /* The play badge is the affordance: it says the still is a video and that
       clicking starts it, which is the one thing the poster cannot say. */
    .play{
      position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
    }
    .play span{
      width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:16px;padding-left:3px;box-sizing:border-box;
    }
    .frame:hover .play span{background:var(--res)}
    /* An ordinary page: the site's own favicon, its host, and the path. No
       fetched title, because there is no honest way to have one here. */
    .page{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:12.36px}
    .page:hover{background:var(--panel)}
    .page img{width:16px;height:16px;flex:none;border-radius:2px}
    .page .who{flex:1;min-width:0}
    .page .h{font-size:12px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .page .u{font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cap{padding:6px 2px 0;font-size:11px;color:var(--mut)}
  `;

  constructor() {
    super();
    this._playing = false;
  }

  updated(changed) {
    // A different link is a different video: never keep the last one playing.
    if (changed.has('url')) this._playing = false;
  }

  render() {
    const p = previewOf(this.url);
    if (!p) return nothing;

    if (p.kind === 'image') {
      return html`<a class="wrap" href=${p.url} target="_blank" rel="noopener">
        <div class="frame"><img alt="" src=${p.thumb} loading="lazy"></div>
        <div class="cap">${previewLabel(p)}</div>
      </a>`;
    }

    if (p.embed) {
      if (this._playing) {
        return html`<div class="frame"><iframe src=${p.embed + '?autoplay=1'} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Video"></iframe></div>`;
      }
      return html`
        <div class="frame" title="Play (loads ${p.host})" @click=${() => { this._playing = true; }}>
          ${p.thumb ? html`<img alt="" src=${p.thumb} loading="lazy">` : nothing}
          <div class="play"><span>&#9654;</span></div>
        </div>
        <div class="cap">${previewLabel(p)}</div>
      `;
    }

    // Direct media the browser can play from the URL, and anything else.
    if (p.kind === 'video') return html`<div class="frame"><video controls preload="none" src=${p.url}></video></div>`;
    if (p.kind === 'audio') return html`<audio style="width:100%" controls preload="none" src=${p.url}></audio>`;

    return html`
      <a class="wrap" href=${p.url} target="_blank" rel="noopener">
        <div class="page">
          ${p.icon ? html`<img alt="" src=${p.icon} loading="lazy" @error=${(e) => { e.target.style.visibility = 'hidden'; }}>` : nothing}
          <div class="who">
            <div class="h">${p.host}</div>
            <div class="u">${p.url.replace(/^https?:\/\/(www\.)?/, '')}</div>
          </div>
        </div>
      </a>
    `;
  }
}

customElements.define('pandemonium-link-card', PandemoniumLinkCard);

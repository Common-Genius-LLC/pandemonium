'use strict';

import { LitElement, html, css, nothing } from 'lit';
import { mediaKind } from '../../data/research-doc.js';

// Shows the piece of media a research source carries. Before this existed,
// dropping a file on the research panel made a record whose card was blank and
// whose reader said "Nothing here yet. Switch to Edit to write this source",
// which was false: there was something there, and no amount of editing the
// body would show it. Every attachment now renders as itself, and anything we
// cannot render inline is offered as a download rather than shown badly.
//
// Purely presentational: it takes the attachment and owns nothing but the
// object URL it needs. The reader owns removing or replacing the file.
//
// Why an object URL rather than the stored data URL: a data: URL works as an
// <img>/<video> src, but Chrome refuses to navigate a tab to one and refuses
// to render a PDF from one, so Open and the PDF frame need a blob. It is
// created lazily, once per attachment, and revoked when this element goes away.
export class PandemoniumAttachmentViewer extends LitElement {
  static properties = { attachment: { type: Object } };

  static styles = css`
    :host{display:block}
    .wrap{background:var(--bg);border-radius:12.36px;overflow:hidden;position:relative}
    .wrap img{display:block;width:100%;max-height:52vh;object-fit:contain;background:var(--ph)}
    .wrap video{display:block;width:100%;max-height:52vh;background:#000}
    .wrap audio{display:block;width:100%;padding:12px;box-sizing:border-box}
    .wrap embed{display:block;width:100%;height:52vh;border:0}
    .generic{display:flex;align-items:center;gap:12px;padding:18px}
    .generic .nm{flex:1;min-width:0;font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .generic .mime{font-size:11px;color:var(--mut)}
    /* Actions sit on the media, revealed on hover, so the file reads as the
       object and not as a row of buttons with a picture attached. */
    /* Hidden means unclickable, not just invisible: an opacity:0 control still
       takes the click that was meant for what is under it. */
    .acts{position:absolute;right:8px;bottom:8px;display:flex;gap:5px;opacity:0;transition:opacity .12s;pointer-events:none}
    .wrap:hover .acts,.acts:focus-within{opacity:1;pointer-events:auto}
    .generic .acts{position:static;opacity:1;pointer-events:auto}
    a.pill{
      font-family:var(--sans);font-size:11px;font-weight:500;line-height:1;padding:6px 10px;border:0;border-radius:20px;
      cursor:pointer;background:var(--overlay);color:var(--overlay-ink);text-decoration:none;white-space:nowrap;
    }
    a.pill:hover{background:var(--ui)}
  `;

  #url = null;
  #forData = null;

  disconnectedCallback() {
    this.#revoke();
    super.disconnectedCallback();
  }

  #revoke() {
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    this.#forData = null;
  }

  // Blob URL for the current attachment, rebuilt only when the data changes.
  // Falls back to the data URL itself if the browser will not take the blob,
  // so a failure here degrades to "works everywhere but Open" rather than
  // to a blank frame.
  #objectUrl() {
    const data = this.attachment && this.attachment.data;
    if (!data) return '';
    if (this.#forData === data && this.#url) return this.#url;
    this.#revoke();
    try {
      const [head, b64] = String(data).split(',');
      const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.#url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      this.#forData = data;
      return this.#url;
    } catch {
      return data;
    }
  }

  #acts(name) {
    const url = this.#objectUrl();
    return html`
      <div class="acts">
        <a class="pill" href=${url} target="_blank" rel="noopener">Open</a>
        <a class="pill" href=${url} download=${name || 'file'}>Download</a>
      </div>
    `;
  }

  render() {
    const att = this.attachment;
    if (!att || !att.data) return nothing;
    const kind = mediaKind(att);
    const name = att.name || 'file';
    if (kind === 'image') {
      return html`<div class="wrap"><img alt=${name} src=${att.data}>${this.#acts(name)}</div>`;
    }
    if (kind === 'video') {
      return html`<div class="wrap"><video controls preload="metadata" src=${att.data}></video>${this.#acts(name)}</div>`;
    }
    if (kind === 'audio') {
      return html`<div class="wrap"><audio controls preload="metadata" src=${att.data}></audio>${this.#acts(name)}</div>`;
    }
    if (kind === 'pdf') {
      return html`<div class="wrap"><embed type="application/pdf" src=${this.#objectUrl()}>${this.#acts(name)}</div>`;
    }
    return html`
      <div class="wrap generic">
        <div class="nm">${name}<div class="mime">${att.mime || 'file'}</div></div>
        ${this.#acts(name)}
      </div>
    `;
  }
}

customElements.define('pandemonium-attachment-viewer', PandemoniumAttachmentViewer);

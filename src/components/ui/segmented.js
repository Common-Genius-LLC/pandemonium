'use strict';

import { LitElement, html, css } from 'lit';

// <pd-segmented .options=${[{value, label, title?}]} .value=${v} @change=${e => e.detail.value}>
//
// A choice among a few, drawn as pills in a pill track with ONE filled pill
// that slides to the chosen option. Used wherever the app switches between a
// handful of states: storyboards Final / Reference (boards panel and the
// slideshow) and the choices in Settings. One component so they all move the
// same way.
//
// The slide is the point, not decoration: when the fill travels from "Final"
// to "Reference", the eye follows it, and the change of state is something
// seen happening rather than inferred from two pills swapping colour.
//
// Colours come from custom properties with token defaults, so a surface that
// is not the page (the slideshow is always dark) can set its own:
//   --seg-track  the track        (default --panel)
//   --seg-thumb  the chosen pill  (default --overlay)
//   --seg-ink    other labels     (default --mut)
//   --seg-ink-on the chosen label (default --overlay-ink)
//
// Keyboard: it is a radio group. Arrow keys move the choice, and the chosen
// option is the one tab stop.
export class PdSegmented extends LitElement {
  static properties = {
    options: { type: Array },
    value: {},
    label: { type: String }, // accessible name for the group
  };

  static styles = css`
    :host{display:inline-flex}
    .track{
      position:relative;display:inline-flex;gap:2px;padding:3px;border-radius:20px;
      background:var(--seg-track,var(--panel));
    }
    .thumb{
      position:absolute;top:3px;bottom:3px;left:0;width:0;border-radius:20px;
      background:var(--seg-thumb,var(--overlay));pointer-events:none;
      transition:transform var(--dur-2) var(--ease-in-out),width var(--dur-2) var(--ease-in-out);
    }
    .thumb.still{transition:none}
    button{
      position:relative;z-index:1;height:24px;padding:0 12px;border:0;border-radius:20px;
      font-family:var(--sans);font-size:11px;font-weight:500;white-space:nowrap;
      color:var(--seg-ink,var(--mut));background:transparent;cursor:pointer;
      transition:color var(--dur-2) var(--ease-out);
    }
    button:hover{color:var(--seg-ink-hover,var(--ink))}
    button.on,button.on:hover{color:var(--seg-ink-on,var(--overlay-ink))}
    button:focus-visible{outline:2px solid var(--link);outline-offset:1px}
  `;

  constructor() {
    super();
    this.options = [];
    this.value = null;
    this._placed = false;
  }

  firstUpdated() {
    // Label widths change when the web font arrives; follow them.
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this.#place());
      this._ro.observe(this.renderRoot.querySelector('.track'));
    }
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    super.disconnectedCallback();
  }

  updated() {
    this.#place();
  }

  // Under the chosen button. The first placement does not animate, so the
  // control appears with its pill already in place.
  #place() {
    const thumb = this.renderRoot.querySelector('.thumb');
    const on = this.renderRoot.querySelector('button.on');
    if (!thumb || !on) return;
    // offsetLeft is measured from the track's padding edge, which is also where
    // the thumb's left:0 sits, so it is used as is. (Subtracting the track's
    // 3px padding here, as it once did, put the pill 3px left of both options:
    // flush to the edge on the first and short of it on the last.)
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    thumb.style.width = on.offsetWidth + 'px';
    if (!this._placed) {
      this._placed = true;
      requestAnimationFrame(() => thumb.classList.remove('still'));
    }
  }

  #choose(value) {
    if (value === this.value) return;
    this.value = value;
    this.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true, composed: true }));
  }

  #key(e) {
    const i = this.options.findIndex((o) => o.value === this.value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = this.options[(i + step + this.options.length) % this.options.length];
    this.#choose(next.value);
    this.updateComplete.then(() => { const b = this.renderRoot.querySelector('button.on'); if (b) b.focus(); });
  }

  render() {
    return html`
      <div class="track" role="radiogroup" aria-label=${this.label || ''} @keydown=${(e) => this.#key(e)}>
        <span class="thumb still" aria-hidden="true"></span>
        ${this.options.map((o) => html`<button role="radio" aria-checked=${o.value === this.value ? 'true' : 'false'}
          tabindex=${o.value === this.value ? '0' : '-1'} class=${o.value === this.value ? 'on' : ''}
          title=${o.title || ''} @click=${() => this.#choose(o.value)}>${o.label}</button>`)}
      </div>
    `;
  }
}

customElements.define('pd-segmented', PdSegmented);

'use strict';

import { LitElement, html, css, svg } from 'lit';
import { CHIPCOLORS } from '../../utils/format.js';

// The clapperboard project card from Figma "Create New Project" (node 7:88),
// lifted out of the start screen so the same surface serves both places a
// project's details get edited: creating one, and clicking its name in the
// title bar. Two forms of the same thing should not be two implementations.
//
// Every offset below is the Figma coordinate translated into the nearest CSS
// equivalent, so the odd fractional pixels are deliberate, not drift. The art
// is the exported Figma vectors inlined as SVG rather than <img>, so it stays
// crisp at any zoom and ships no extra network requests.
//
// `scale` scales the whole assembly. The scaled box is given its own wrapper
// sized to the scaled dimensions, rather than a transform plus a compensating
// margin: the margin version drifts the moment the scale changes, which is how
// the art ended up overlapping the buttons under it.

// Top and bottom clapper stripes. Identical geometry; the bottom one is the
// same artwork flipped on Y, exactly as the design composes it.
const clapperStripes = svg`
  <path d="M226.394 24.6211L201.773 0L226.394 0V24.6211Z" fill="#333333"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M201.773 6.54806e-05L226.394 24.6212L196.969 24.6212L172.348 6.54806e-05L201.773 6.54806e-05Z" fill="#9C9799"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M172.348 6.0154e-05L196.969 24.6212L167.544 24.6212L142.922 6.0154e-05L172.348 6.0154e-05Z" fill="#C21F3C"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M138.118 24.6212L113.497 6.43138e-05L142.923 6.43138e-05L167.544 24.6212L138.118 24.6212Z" fill="#2288DE"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M84.0721 5.89872e-05L113.497 5.89872e-05L138.118 24.6212L108.693 24.6212L84.0721 5.89872e-05Z" fill="#F0D06D"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.2679 24.6212L54.6468 5.36606e-05L84.072 5.36606e-05L108.693 24.6212L79.2679 24.6212Z" fill="#1F8C62"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M0 3.58559e-07H54.6468L79.2679 24.6211H0V3.58559e-07Z" fill="#333333"/>
`;

// The hinge block the top clapper pivots on.
const clapperHinge = svg`
  <path d="M0 35.1301V5.40463C0 2.41974 2.41974 0 5.40464 0H19.6263C21.0914 0 22.4938 0.594857 23.5121 1.64829L37.815 16.4443C38.7892 17.4521 39.3337 18.799 39.3337 20.2006V35.1301C39.3337 38.115 36.914 40.5347 33.9291 40.5347H5.40463C2.41974 40.5347 0 38.115 0 35.1301Z" fill="#989898"/>
  <circle cx="5.70488" cy="34.5296" r="3.30283" fill="#D9D9D9"/>
  <circle cx="5.70488" cy="5.70489" r="3.30283" fill="#D9D9D9"/>
  <circle cx="33.9291" cy="34.5296" r="3.30283" fill="#D9D9D9"/>
`;

const chevron = html`<svg class="chev" viewBox="0 0 7.45492 4.07923" fill="none" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0.424628 0.424628L3.30283 3.30283C3.53735 3.53735 3.91757 3.53735 4.15209 3.30283L7.03029 0.424628" stroke="#DCDCDC" stroke-width="1.20103"/>
</svg>`;

// Unscaled Figma dimensions of the whole clapper group (node 13:396).
const W = 228.692;
const H = 266;

export class PdProjectCard extends LitElement {
  static properties = {
    scale: { type: Number },
    elevated: { type: Boolean, reflect: true },
    projectName: { type: String },
    type: { type: String },
    workspace: { type: String },
    mins: { type: Number },
    contributors: { type: Array },
    // The card owns its edits once opened. Binding the inputs to the incoming
    // properties instead would re-commit the value captured when the card was
    // created on every re-render, wiping out what is being typed the moment
    // anything else on the card changes.
    _name: { state: true },
    _type: { state: true },
    _ws: { state: true },
    _contribs: { state: true },
    _dur: { state: true },
  };

  static styles = css`
    :host{display:block;font-family:var(--sans)}
    .wrap{position:relative;margin:0 auto;flex:none}
    /* drop-shadow, not box-shadow: it follows the actual silhouette, so the
       shadow falls under the angled arm and the card's rounded foot instead
       of under a rectangle around them. Opt-in, because the start screen's
       frame is flat; only the floating copy is lifted. */
    :host([elevated]) .wrap{
      filter:drop-shadow(0 2px 3px rgba(0,0,0,.12)) drop-shadow(0 10px 18px rgba(0,0,0,.22));
    }
    .clapper{position:absolute;left:0;top:0;width:228.692px;height:266px;transform-origin:top left}
    .bar-back{position:absolute;left:2.298px;top:84.04px;width:226.394px;height:24.621px;background:#333}
    .top-clip{
      position:absolute;left:0;top:0;width:225.052px;height:82.377px;
      display:flex;align-items:center;justify-content:center;
    }
    /* The arm pivots at the hinge, not at its own middle, so a swing does not
       drag its left end out from under the hinge block. The translate is what
       makes that equivalent: with the origin moved to the arm's left edge,
       these two values put the resting -15deg frame back exactly where
       rotating about the centre had it, to the pixel. Only the angle animates. */
    .top-clip .rot{
      transform-origin:0 50%;
      transform:translate(3.857px,29.297px) rotate(-15deg);
      width:226.394px;height:24.621px;
      overflow:hidden;border-radius:3.003px 3.003px 0 0;
      animation:pd-clap 900ms both;
    }
    /* Open wide, accelerate shut, and clap once. The downstroke is clean: no
       rebound off the bar, because a clapper does not chatter. The only
       overshoot is at the far end of the swing back open, 4deg past rest,
       which then settles. */
    @keyframes pd-clap{
      0%{transform:translate(3.857px,29.297px) rotate(-46deg);animation-timing-function:cubic-bezier(.5,0,.9,.4)}
      40%{transform:translate(3.857px,29.297px) rotate(0deg);animation-timing-function:cubic-bezier(.25,.75,.4,1)}
      80%{transform:translate(3.857px,29.297px) rotate(-19deg);animation-timing-function:ease-out}
      100%{transform:translate(3.857px,29.297px) rotate(-15deg)}
    }
    @media (prefers-reduced-motion:reduce){
      .top-clip .rot{animation:none}
    }
    .bottom-clip{
      position:absolute;left:2.298px;top:84.04px;
      width:226.394px;height:24.621px;transform:scaleY(-1);
    }
    .hinge{position:absolute;left:9.505px;top:59.727px;width:39.334px;height:40.535px}
    .stripes,.hinge svg{display:block;width:100%;height:100%}

    .card{
      box-sizing:border-box;
      position:absolute;left:2.298px;top:108.665px;
      width:226.394px;height:157.335px;
      background:#fff;border:1.201px solid #dcdcdc;
      border-radius:0 0 18.015px 18.015px;
      overflow:hidden;
    }
    .card .rule{position:absolute;background:#dcdcdc}

    .lbl{
      font-size:9.473px;line-height:12.01px;font-weight:500;
      letter-spacing:-0.0947px;color:rgba(0,0,0,.6);
      white-space:nowrap;
    }
    .val{
      font-size:12.523px;line-height:15.878px;font-weight:500;
      letter-spacing:-0.1252px;color:var(--link);
    }

    /* Inputs are chromeless so a filled field is pixel-identical to the
       static text in the design. */
    input{
      font-family:inherit;background:transparent;border:0;padding:0;margin:0;
      color:inherit;font-size:inherit;line-height:inherit;
      font-weight:inherit;letter-spacing:inherit;
      min-width:0;outline:none;
    }
    input::placeholder{color:currentColor;opacity:.45}

    .name{
      position:absolute;left:12.01px;top:16.81px;transform:translateY(-50%);
      width:200px;
      font-size:14.277px;line-height:17.434px;font-weight:500;color:#000;
    }

    /* Duration cell: 0 to 70.26 across, 34.23 to 87.07 down. */
    .duration{position:absolute;left:0;top:34.23px;width:70.26px;height:52.845px}
    .duration>*{
      position:absolute;left:0;right:0;text-align:center;
      transform:translateY(-50%);
    }
    .duration .lbl.head{top:10.1px}
    .duration .tc{top:26.62px;text-align:center}
    .duration .mins{top:43.73px}

    /* Type and Workspace rows: 70.26 to 226.39 across. */
    .rows{position:absolute;left:70.26px;top:34.23px;width:156.134px}
    .row{
      box-sizing:border-box;
      display:flex;align-items:center;
      height:26.42px;padding:0 13.8px 0 6.74px;
    }
    .row .lbl{flex:none}
    /* The value is right-aligned so it ends on the Figma x of 202, which is
       where both values terminate in the design. */
    .row input{flex:1;text-align:right;padding-left:6px;margin-right:3.98px}
    .chev{width:6.606px;height:3.303px;flex:none;overflow:visible}

    /* Contributors: 87.07 down to the card foot. */
    .contrib-head{
      position:absolute;left:0;right:0;top:99.58px;
      transform:translateY(-50%);text-align:center;
    }
    .tags{
      position:absolute;left:12.01px;right:12.01px;top:112.13px;
      display:flex;align-items:center;gap:8px;height:15.613px;
    }
    .tag{
      box-sizing:border-box;
      display:inline-flex;align-items:center;height:15.613px;
      padding:2px 6px;border-radius:1.802px;
      font-size:9.473px;line-height:12.01px;font-weight:500;
      letter-spacing:-0.0947px;color:rgba(0,0,0,.56);
      white-space:nowrap;cursor:pointer;
    }
    .tag:hover{opacity:.6}
    .tags input{
      flex:1;height:15.613px;
      font-size:9.473px;line-height:12.01px;font-weight:500;
      letter-spacing:-0.0947px;color:rgba(0,0,0,.56);
    }
  `;

  constructor() {
    super();
    this.scale = 1.25;
    this.elevated = false;
    this.projectName = '';
    this.type = '';
    this.workspace = '';
    this.mins = 0;
    this.contributors = null;
    this._name = '';
    this._type = '';
    this._ws = '';
    this._contribs = [];
    this._dur = '';
  }

  willUpdate(changed) {
    // Adopt the values handed in once, then the card owns its own edits.
    if (changed.has('projectName')) this._name = this.projectName || '';
    if (changed.has('type')) this._type = this.type || '';
    if (changed.has('workspace')) this._ws = this.workspace || '';
    if (changed.has('contributors') && this.contributors) this._contribs = this.contributors.slice();
    if (changed.has('mins') && this.mins) this._dur = this.#tc(this.mins);
  }

  // Every edit reports the whole card. Callers that want live updates just
  // listen; callers that only commit at the end call read() instead.
  #changed() {
    this.dispatchEvent(new CustomEvent('pd-project-change', {
      detail: this.read(), bubbles: true, composed: true,
    }));
  }

  #tc(m) {
    const pad = (n) => String(n).padStart(2, '0');
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':00';
  }

  // Accepts HH:MM:SS, HH:MM, or a plain minute count, so the timecode field
  // stays typeable without a mask. Anything unparseable reads as zero.
  #mins() {
    const parts = this._dur.split(':').map((p) => parseInt(p, 10) || 0);
    if (parts.length >= 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  #normalizeDur() {
    if (!this._dur.trim()) return;
    this._dur = this.#tc(this.#mins());
  }

  #addContrib(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    this._contribs = [...this._contribs, { n: v, color: CHIPCOLORS[this._contribs.length % CHIPCOLORS.length] }];
    e.target.value = '';
    this.#changed();
  }

  #removeContrib(ix) {
    this._contribs = this._contribs.filter((_, i) => i !== ix);
    this.#changed();
  }

  // What the caller writes back to the project. The one way to read this card.
  read() {
    return {
      name: this._name.trim(),
      type: this._type.trim(),
      workspace: this._ws.trim(),
      targetMins: this.#mins(),
      contributors: this._contribs.slice(),
    };
  }

  render() {
    const mins = this.#mins();
    const s = this.scale;
    return html`
      <div class="wrap" style="width:${W * s}px;height:${H * s}px">
        <div class="clapper" style="transform:scale(${s})">
          <div class="bar-back"></div>
          <div class="top-clip">
            <div class="rot">
              <svg class="stripes" viewBox="0 0 226.394 24.6212" fill="none" preserveAspectRatio="none" aria-hidden="true">${clapperStripes}</svg>
            </div>
          </div>
          <div class="bottom-clip">
            <svg class="stripes" viewBox="0 0 226.394 24.6211" fill="none" preserveAspectRatio="none" aria-hidden="true">${clapperStripes}</svg>
          </div>
          <div class="hinge">
            <svg viewBox="0 0 39.3337 40.5347" fill="none" preserveAspectRatio="none" aria-hidden="true">${clapperHinge}</svg>
          </div>

          <div class="card">
            <input class="name" id="npName" type="text" placeholder="Title" aria-label="Project name"
              .value=${this._name}
              @input=${(e) => { this._name = e.target.value; this.#changed(); }}>

            <div class="rule" style="left:-0.3px;top:33.63px;width:225.193px;height:1.201px"></div>
            <div class="rule" style="left:69.66px;top:34.23px;width:1.201px;height:52.845px"></div>
            <div class="rule" style="left:70.26px;top:60.05px;width:154.933px;height:1.201px"></div>
            <div class="rule" style="left:-0.3px;top:86.47px;width:225.193px;height:1.201px"></div>

            <div class="duration">
              <div class="lbl head">Duration</div>
              <input class="val tc" id="npDur" type="text" placeholder="00:00:00" aria-label="Target duration"
                .value=${this._dur}
                @input=${(e) => { this._dur = e.target.value; this.#changed(); }}
                @blur=${() => { this.#normalizeDur(); this.#changed(); }}>
              <div class="lbl mins">${mins} ${mins === 1 ? 'min' : 'mins'}</div>
            </div>

            <div class="rows">
              <div class="row">
                <span class="lbl">Type</span>
                <input class="val" id="npType" type="text" placeholder="Short/Feature" aria-label="Project type"
                  .value=${this._type}
                  @input=${(e) => { this._type = e.target.value; this.#changed(); }}>
                ${chevron}
              </div>
              <div class="row">
                <span class="lbl">Workspace</span>
                <input class="val" id="npWs" type="text" placeholder="Production" aria-label="Workspace"
                  .value=${this._ws}
                  @input=${(e) => { this._ws = e.target.value; this.#changed(); }}>
                ${chevron}
              </div>
            </div>

            <div class="lbl contrib-head">Contributors</div>
            <div class="tags">
              ${this._contribs.map((c, ix) => html`
                <span class="tag" style="background:${c.color}" title="Remove ${c.n}"
                  @click=${() => this.#removeContrib(ix)}>${c.n}</span>
              `)}
              <input type="text" placeholder=${this._contribs.length ? 'Add' : 'Add a name, press Enter'}
                aria-label="Add a contributor" @keydown=${(e) => this.#addContrib(e)}>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('pd-project-card', PdProjectCard);

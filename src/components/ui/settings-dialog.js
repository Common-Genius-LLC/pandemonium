'use strict';

import { LitElement, html, css } from 'lit';
import { StoreController } from '../../state/store-controller.js';
import { theme } from '../../state/theme.js';
import { scriptPrefs, TEXT_SIZES } from '../../state/script-prefs.js';
import { PAPERS, pageGrid } from '../../fountain/paginate.js';
import { formStyles } from '../../styles/shared.js';
import './segmented.js';

// Everything that is a preference rather than an action, in one place, reached
// from File > Settings.
//
// These used to be scattered: the theme was a glyph in the title bar and a row
// on every right-click menu, and the storyboard drop target was a submenu two
// levels into File. A setting is not a thing you do, it is a thing you decide
// once, so hunting for each one in a different corner is the wrong shape. It
// also means the right-click menu is back to being about what was clicked.
//
// Everything here acts the moment it is touched, which is why the dialog that
// holds it offers Done and no Save or Cancel (see `doneOnly` in dialog.js):
// there is nothing pending to confirm or to throw away.
//
// The two branches of state are deliberately kept apart, as they are
// everywhere else in this app: the theme is about the person at the keyboard
// and lives in localStorage (state/theme.js), while the drop target is about
// how a project is being worked on and rides in the project file.
export class PdSettings extends LitElement {
  static styles = [formStyles, css`
    :host{display:block}
    section{margin-bottom:18px}
    section:last-of-type{margin-bottom:0}
    h4{
      margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:.08em;
      text-transform:uppercase;color:var(--mut);
    }
    .row{display:block;margin-bottom:10px}
    .row:last-child{margin-bottom:0}
    .what{font-size:12px;color:var(--ink);margin-bottom:6px}
    .why{font-size:11px;line-height:1.5;color:var(--mut);margin:4px 0 0}

  `];

  constructor() {
    super();
    this._store = new StoreController(this);
    this._onPref = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    theme.addEventListener('change', this._onPref);
    scriptPrefs.addEventListener('change', this._onPref);
  }

  disconnectedCallback() {
    theme.removeEventListener('change', this._onPref);
    scriptPrefs.removeEventListener('change', this._onPref);
    super.disconnectedCallback();
  }

  // A segmented choice (ui/segmented.js), because these are all "pick one of
  // a few" and a select would hide the alternatives behind a click.
  #seg(options, current, pick, label) {
    return html`<pd-segmented .options=${options} .value=${current} label=${label || ''}
      @change=${(e) => pick(e.detail.value)}></pd-segmented>`;
  }

  render() {
    const project = this._store.project;
    // "Match system" is offered here for the first time: the title-bar glyph
    // could only ever flip between light and dark, so the preference that
    // follows the desktop at sunset had no way back once it was left.
    const appearance = html`
      <section>
        <h4>Appearance</h4>
        <div class="row">
          <div class="what">Theme</div>
          ${this.#seg(
            [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match system' }],
            theme.preference,
            (v) => theme.set(v),
          )}
          <p class="why">Kept for you, not for the project, so it follows you between projects and devices are free to differ.</p>
        </div>
      </section>
    `;

    // The script's page. Both are about this screen, not the project, like
    // the theme, and neither moves a page break: the grid is fixed per paper
    // and the text size only scales how large the page is drawn.
    const grid = pageGrid(scriptPrefs.paper);
    const script = html`
      <section>
        <h4>Script</h4>
        <div class="row">
          <div class="what">Paper</div>
          ${this.#seg(
            Object.entries(PAPERS).map(([value, p]) => ({ value, label: p.label })),
            scriptPrefs.paper,
            (v) => scriptPrefs.set({ paper: v }),
            'Paper size',
          )}
          <p class="why">${grid.cols} characters a line, ${grid.rows} lines a page, at the standard 12pt Courier.</p>
        </div>
        <div class="row">
          <div class="what">Text size</div>
          ${this.#seg(
            TEXT_SIZES.map((pt) => ({ value: pt, label: pt === 12 ? '12pt' : String(pt) })),
            scriptPrefs.textPt,
            (v) => scriptPrefs.set({ textPt: v }),
            'Script text size',
          )}
          <p class="why">12pt is the standard size, fitted to the pane. Larger sizes draw the page bigger (it scrolls sideways if the pane is narrow), smaller sizes draw it smaller. Page breaks and the page count never move.</p>
        </div>
      </section>
    `;

    if (!project) return html`${appearance}${script}`;

    const toRef = project.dropToReference !== false;
    return html`
      ${appearance}
      ${script}
      <section>
        <h4>Storyboards</h4>
        <div class="row">
          <div class="what">An image dropped on the script or the timeline becomes</div>
          ${this.#seg(
            [{ value: true, label: 'Reference frame' }, { value: false, label: 'Final frame' }],
            toRef,
            (v) => this._store.store.setDropToReference(v),
          )}
          <p class="why">Only a final frame counts towards the boarded percentage on the timeline. A reference frame is inspiration for the beat.</p>
        </div>
      </section>
    `;
  }
}

customElements.define('pd-settings', PdSettings);

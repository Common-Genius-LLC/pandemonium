'use strict';

import { LitElement, html, css } from 'lit';
import { dispatch } from '../../utils/events.js';
import { LOGIN_PATH } from '../../app-root/gate.js';
import '../ui/logo.js';
import '../ui/button.js';
import '../ui/project-card.js';

// What someone sees who is not signed in. Its one job is to say what
// Pandemonium is and get them to the sign-in page, so it lists every feature the
// app has and nothing it does not: each entry below describes something that
// ships (see CLAUDE.md), in plain words.
//
// Flat, muted, no borders, solid fills, all from the theme tokens (so it follows
// light and dark like every other screen). Each feature carries one dot in the
// colour the app itself uses for that idea: green for storyboards, pink for
// references, and so on, so the page teaches the colours the editor will use.
//
// Every "Get Started" goes to the sign-in page through `pandemonium-navigate`;
// the shell owns the address bar (see pandemonium-app.js).

// [tag, dot colour token, title, body]
const FEATURES = [
  ['Script', '--link', 'A Fountain editor that never rewrites you',
    'Scene headings, dialogue, centered text, notes, boneyard, sections and title pages all come back exactly as you typed them. Pages are laid out on A4 or Letter at the standard 12pt Courier grid, with a minimap and a focus mode for when you just want to write.'],
  ['Drafts', '--act', 'Many drafts, one final',
    'Keep as many drafts as you like and promote one to final. Storyboards, comments and the timeline follow the final draft, so they never drift across versions. Import a .fountain file as a new draft whenever you need to.'],
  ['Storyboards', '--board-strong', 'Frames attached to the lines they draw',
    'Link a storyboard to any passage of the script. Each one holds a final frame and a reference frame, and a scene can have as many as it needs, in order. Drop in images or video, or leave a board blank to claim a beat you have not drawn yet.'],
  ['Preview', '--board-ref', 'Play the film before it exists',
    'Preview plays your boards as a slideshow with the script along the bottom. Script that sits between two boards plays too, lines can be edited in place as you watch, and recording your pacing turns a word-count guess into a measured running time.'],
  ['References', '--res', 'Back every claim with a source',
    'Collect notes, links, images, video, audio and PDFs. Links unfold into rich previews, and everything can be filed in folders and grouped by label. Highlight a passage in a reference and tie it to the script line it supports.'],
  ['Links', '--act', 'See what is attached to every line',
    'Linked words take the colour of what they carry: green for a storyboard, pink for a reference, amber for a comment. Click them and everything attached to that line opens in one place.'],
  ['Timeline', '--ok', 'A timeline that tells the truth',
    'See how much of the script is storyboarded, how much is backed by references, and the estimated running time. If a number cannot be worked out reliably, Pandemonium shows it as unknown instead of guessing.'],
  ['Search', '--link', 'Find anything, fast',
    'One search across scripts, storyboards, references and notes, one keystroke away: Cmd or Ctrl K from anywhere in a project.'],
  ['Layout', '--sound', 'Arrange the workspace your way',
    'Split, merge and drag panes into any arrangement, each showing the script, the storyboards, the references or the timeline. The layout is saved with the project, so it opens the way you left it.'],
  ['Together', '--res', 'Work with other people',
    'Share a project with collaborators as viewers or editors, or send a read-only link to the final draft and its boards. When two people edit at once, their changes are merged instead of one overwriting the other.'],
  ['Export', '--board-strong', 'Take your work with you',
    'Export the script or the storyboards as a PDF, download a .fountain file, or save the whole project as a file of your own. Your work stays yours to take.'],
  ['Themes', '--ui', 'Light for the day, dark for the night',
    'A midnight palette built for dark rooms, or let it follow your system.'],
];

export class PandemoniumLanding extends LitElement {
  static styles = css`
    :host{
      position:fixed;inset:0;z-index:60;overflow:auto;
      background:var(--bg);color:var(--ink);font-family:var(--sans);
      scroll-behavior:smooth;
    }
    @media (prefers-reduced-motion:reduce){:host{scroll-behavior:auto}}
    .wrap{width:min(1120px,100% - 48px);margin:0 auto}

    /* One backdrop for the top of the page, the same wash the home screen uses,
       so signing in does not change the room. */
    .top-band{background:linear-gradient(180deg,var(--scrim-a) 0%,var(--scrim-b) 100%)}

    header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 0}
    pd-logo{font-size:22px;color:var(--res)}
    nav{display:flex;align-items:center;gap:8px}
    .link{
      font-family:var(--sans);font-size:13px;font-weight:500;color:var(--ui);background:none;border:0;
      padding:6px 12px;border-radius:20px;cursor:pointer;
      transition:background var(--dur-1) var(--ease-out);
    }
    .link:hover{background:color-mix(in srgb,var(--ink) 8%,transparent)}
    @media (max-width:560px){.link.feat{display:none}}

    .hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);align-items:center;gap:48px;padding:56px 0 88px}
    .eyebrow{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin-bottom:18px}
    h1{font-size:clamp(38px,6vw,68px);line-height:1.02;letter-spacing:-.025em;font-weight:600;margin:0 0 22px}
    .lede{font-size:clamp(16px,1.6vw,19px);line-height:1.55;color:var(--ui);max-width:34em;margin:0 0 32px}
    .cta{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
    .fine{font-size:12px;color:var(--mut);margin-top:18px;max-width:36em;line-height:1.5}
    /* The clapperboard is the product's own mark; here it claps once on arrival.
       Inert: it is an illustration, not a control. */
    .art{display:flex;justify-content:center}
    .art pd-project-card{filter:drop-shadow(0 10px 22px rgba(0,0,0,.16))}
    @media (max-width:860px){
      .hero{grid-template-columns:minmax(0,1fr);padding:32px 0 56px;gap:36px}
      .art{order:-1}
    }

    section{padding:80px 0}
    .band{background:var(--panel)}
    h2{font-size:clamp(26px,3.6vw,40px);line-height:1.1;letter-spacing:-.02em;font-weight:600;margin:0 0 14px}
    .sub{font-size:16px;line-height:1.55;color:var(--ui);max-width:38em;margin:0 0 44px}

    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px}
    /* A card on the tinted band is the page colour, so it reads as raised without
       a border or a shadow. */
    .card{background:var(--bg);border-radius:20px;padding:24px 24px 26px}
    .tag{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin-bottom:14px}
    .dot{width:10px;height:10px;border-radius:50%;flex:none}
    h3{font-size:18px;line-height:1.25;letter-spacing:-.01em;font-weight:600;margin:0 0 10px}
    .card p{font-size:14px;line-height:1.6;color:var(--ui);margin:0}

    .last{text-align:center}
    .last .sub{margin-left:auto;margin-right:auto;margin-bottom:30px}
    footer{padding:0 0 36px;text-align:center;font-size:13px;color:var(--ink)}
    footer i{font-style:italic}
  `;

  #start() {
    dispatch(this, 'pandemonium-navigate', { path: LOGIN_PATH });
  }

  #seeFeatures() {
    const el = this.renderRoot.getElementById('features');
    if (el) el.scrollIntoView({ block: 'start' });
  }

  render() {
    return html`
      <div class="top-band">
        <div class="wrap">
          <header>
            <pd-logo></pd-logo>
            <nav aria-label="Main">
              <button class="link feat" @click=${() => this.#seeFeatures()}>Features</button>
              <button class="link" @click=${() => this.#start()}>Sign in</button>
              <pd-button variant="pink" @click=${() => this.#start()}>Get Started</pd-button>
            </nav>
          </header>

          <div class="hero">
            <div>
              <div class="eyebrow">Film pre-production, in one place</div>
              <h1>Write it. Board it. Source it.</h1>
              <p class="lede">Pandemonium keeps your script, your storyboards and your research together, so every frame and every claim points back to the exact line it belongs to.</p>
              <div class="cta">
                <pd-button variant="pink" size="lg" @click=${() => this.#start()}>Get Started</pd-button>
                <pd-button size="lg" @click=${() => this.#seeFeatures()}>See what is inside</pd-button>
              </div>
              <div class="fine">Your script stays in Fountain, the plain-text screenplay format that every screenwriting tool understands.</div>
            </div>
            <div class="art" aria-hidden="true">
              <pd-project-card inert compact .scale=${1.05} .projectName=${'Your Project'}></pd-project-card>
            </div>
          </div>
        </div>
      </div>

      <section class="band" id="features">
        <div class="wrap">
          <h2>Everything a film needs before the camera turns</h2>
          <p class="sub">One place for the script, the boards and the sources behind them, with a timeline that shows how finished you really are.</p>
          <div class="grid">
            ${FEATURES.map(([tag, color, title, body]) => html`
              <div class="card">
                <div class="tag"><span class="dot" style="background:var(${color})"></span>${tag}</div>
                <h3>${title}</h3>
                <p>${body}</p>
              </div>
            `)}
          </div>
        </div>
      </section>

      <section class="last">
        <div class="wrap">
          <h2>Start your first project</h2>
          <p class="sub">Create an account, then write, board and source it in one place.</p>
          <pd-button variant="pink" size="lg" @click=${() => this.#start()}>Get Started</pd-button>
        </div>
      </section>

      <footer>A Project by <i>Common Genius</i></footer>
    `;
  }
}

customElements.define('pandemonium-landing', PandemoniumLanding);

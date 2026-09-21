'use strict';

import { LitElement, html, css } from 'lit';
import { dispatch } from '../../utils/events.js';
import { LOGIN_PATH } from '../../app-root/gate.js';
import '../ui/logo.js';
import '../ui/button.js';
import '../ui/project-card.js';

// What someone sees who is not signed in. Its one job is to say what
// Pandemonium is and get them to the sign-in page, so it lists what the app
// really does and nothing it does not: every line below describes something
// that ships (see CLAUDE.md), in plain words.
//
// It is ordered by importance. The four things the product is (the script, the
// boards, the references, the timeline) each get a full section with the detail
// and a drawing; the idea that ties them together (linking) gets a band of its
// own; the rest is a grid of smaller cards. The drawings are made of the app's
// own tokens and carry no figures, so nothing here can misstate what the
// product computes.
//
// Flat, muted, no borders, solid fills, all from the theme tokens, so it
// follows light and dark like every other screen. Each feature carries one dot
// in the colour the app itself uses for that idea (green for storyboards, pink
// for references), so the page teaches the colours the editor will use.
//
// Every "Get Started" goes to the sign-in page through `pandemonium-navigate`;
// the shell owns the address bar (see pandemonium-app.js).

// The four things the product is. `visual` names the drawing in #visual().
const PILLARS = [
  {
    tag: 'Script', color: '--link', visual: 'script',
    title: 'A Fountain editor that never rewrites you',
    lede: 'Write the screenplay in plain Fountain, in an editor that treats the format as sacred. What you type is what is saved, and what you open is what you wrote.',
    points: [
      'Scene headings, dialogue, centered text, notes, boneyard, sections and title pages all come back exactly as typed.',
      'See real pages: A4 or Letter on the standard 12pt Courier grid, with printed page numbers and a minimap.',
      'Keep many drafts and promote one to final. Import a .fountain file as a new draft whenever you need to.',
      'A focus mode for when all you want to do is write.',
    ],
  },
  {
    tag: 'Storyboards', color: '--board-strong', visual: 'boards',
    title: 'Frames attached to the lines they draw',
    lede: 'Select any words in the script and link a storyboard to them. Each storyboard holds a final frame and a reference frame, so the shot you have drawn and the inspiration behind it sit side by side.',
    points: [
      'As many storyboards as a scene needs, in the order you set. Leave one blank to claim a beat you have not drawn yet.',
      'Drop images or video into a board, onto a slide while it plays, or straight onto the timeline.',
      'Preview plays the boards as a slideshow with the script along the bottom. Script that sits between two boards plays too, and you can drag to resize the picture and the text.',
      'Record your pacing as you click through, and the running time becomes a measurement instead of a guess.',
    ],
  },
  {
    tag: 'References', color: '--res', visual: 'refs',
    title: 'Back every claim with a source',
    lede: 'Keep the research beside the script it supports. Notes, links, images, video, audio and PDFs live in one place, and each can be tied to the exact lines it backs.',
    points: [
      'Paste a link and it unfolds into a rich preview with a title, a description and an image. Files open right in the panel.',
      'File sources in folders, group them by label and colour them like sticky notes.',
      'Highlight a passage inside a reference and link it to a script line. Click either end to see the other.',
      'Filter to the sources that back nothing yet, so nothing sits unused.',
    ],
  },
  {
    tag: 'Timeline', color: '--ok', visual: 'timeline',
    title: 'A timeline that tells the truth',
    lede: 'Above everything sits one honest picture of how finished the film really is, worked out from the final draft alone.',
    points: [
      'How much of the script is storyboarded, how much is backed by references, and the estimated running time.',
      'Only real work counts. A blank storyboard or a reference frame is a claim on a beat, not a drawn shot, so it never raises the number.',
      'Where you have recorded pacing, the length is measured and marked as measured.',
      'If a number cannot be worked out reliably, it shows as unknown. It is never invented.',
    ],
  },
];

// The idea underneath the four: every link marks the words it belongs to.
const LINKS = [
  ['--board-strong', 'Storyboard', 'Words with a frame attached turn green.', 'pours coffee'],
  ['--res', 'Reference', 'Words backed by a source turn pink.', 'the old lighthouse'],
  ['--act', 'Comment', 'Words with a note for the writer turn amber.', 'too long?'],
];

// Everything else, smaller: [tag, dot colour token, title, body]
const MORE = [
  ['Search', '--link', 'Find anything, fast',
    'One search across scripts, storyboards, references and notes, one keystroke away: Cmd or Ctrl K from anywhere in a project.'],
  ['Workspace', '--sound', 'Arrange it your way',
    'Split, merge and drag panes into any arrangement, each showing the script, the storyboards, the references or the timeline. The layout is saved with the project.'],
  ['Together', '--res', 'Work with other people',
    'Share a project with collaborators as viewers or editors, or send a read-only link to the final draft and its boards. When two people edit at once, their changes are merged instead of one overwriting the other.'],
  ['Anywhere', '--ok', 'Open it on any device',
    'Projects live in your account and are saved as you work, so they are there on whichever machine you sit down at.'],
  ['Export', '--board-strong', 'Take your work with you',
    'Export the script or the storyboards as a PDF, download a .fountain file, or save the whole project as a file of your own.'],
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
    /* On a phone the header keeps only the one action: Get Started leads to the
       sign-in page, which is also where someone returning signs in. */
    @media (max-width:560px){
      .link{display:none}
      pd-logo{font-size:17px}
    }

    .hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);align-items:center;gap:48px;padding:64px 0 96px}
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

    /* Sections alternate between the page and a tinted band, so the page has a
       rhythm and each feature has its own room. */
    section{padding:88px 0}
    section.alt{background:var(--panel)}
    h2{font-size:clamp(26px,3.6vw,40px);line-height:1.1;letter-spacing:-.02em;font-weight:600;margin:0 0 14px}
    .sub{font-size:16px;line-height:1.55;color:var(--ui);max-width:38em;margin:0 0 44px}
    .tag{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin-bottom:16px}
    .dot{width:10px;height:10px;border-radius:50%;flex:none}

    /* A pillar: the words on one side, a drawing on the other, and the drawing
       swaps sides down the page. */
    .pillar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:64px}
    .pillar.flip .vis{order:-1}
    .pillar h2{font-size:clamp(28px,3.8vw,44px)}
    .pillar .lede{font-size:17px;margin-bottom:26px}
    ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
    li{position:relative;padding-left:22px;font-size:15px;line-height:1.55;color:var(--ink)}
    li::before{content:"";position:absolute;left:0;top:.5em;width:8px;height:8px;border-radius:50%;background:var(--c)}
    @media (max-width:860px){
      section{padding:56px 0}
      .pillar{grid-template-columns:minmax(0,1fr);gap:36px}
      .pillar.flip .vis{order:0}
    }

    /* The drawings. On a plain section the frame is the tint; on a tinted one it
       is the page colour, so it is always the odd one out. */
    .vis{background:var(--panel);border-radius:20px;padding:32px;display:flex;align-items:center;justify-content:center;min-height:340px;box-sizing:border-box}
    section.alt .vis{background:var(--bg)}

    /* Script: a page, with words linked. The link colours are the editor's,
       mixed toward the ink so they stay legible in both themes. */
    .page{
      width:min(100%,340px);box-sizing:border-box;padding:26px 30px 30px;position:relative;
      background:var(--field);border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.12);
      font-family:var(--script);font-size:13px;line-height:1.55;color:var(--ink);
    }
    .page .pn{position:absolute;top:10px;right:16px;font-size:11px;color:var(--mut)}
    .page .sl{font-weight:700;text-transform:uppercase}
    .page .act{margin-top:.8em}
    .page .cue{margin-top:1em;text-align:center;font-weight:700}
    .page .par{text-align:center;color:var(--mut)}
    .page .dlg{max-width:66%;margin:0 auto}
    .g{color:color-mix(in srgb,var(--board-strong) 70%,var(--ink))}
    .p{color:color-mix(in srgb,var(--res) 78%,var(--ink))}
    .a{color:color-mix(in srgb,var(--act) 55%,var(--ink))}

    /* Storyboards: a strip of frames, one blank. Frames use the app's 12.36px
       radius, and the tints are the storyboard colours. */
    .strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 14px;width:100%}
    .frame{margin:0;min-width:0}
    .shot{aspect-ratio:16/9;border-radius:12.36px;position:relative;overflow:hidden;background:var(--ph)}
    .shot.fin{background:color-mix(in srgb,var(--board-strong) 42%,var(--bg))}
    .shot.ref{background:color-mix(in srgb,var(--board-ref) 42%,var(--bg))}
    .shot.fin::before,.shot.ref::before{content:"";position:absolute;left:16%;bottom:0;width:24%;height:60%;border-radius:45% 45% 0 0;background:color-mix(in srgb,var(--ink) 20%,transparent)}
    .shot.fin::after,.shot.ref::after{content:"";position:absolute;right:16%;top:16%;width:15%;aspect-ratio:1;border-radius:50%;background:color-mix(in srgb,var(--bg) 70%,transparent)}
    .pill{position:absolute;left:8px;top:8px;font-style:normal;font-size:9px;font-weight:600;letter-spacing:.04em;padding:3px 8px;border-radius:20px;background:var(--overlay);color:var(--overlay-ink);z-index:1}
    figcaption{margin-top:9px;font-family:var(--script);font-size:11px;line-height:1.4;color:var(--ui)}

    /* References: sticky notes in the note colours, stacked. */
    .notes{display:flex;flex-direction:column;gap:12px;width:min(100%,340px)}
    .note{border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:4px}
    .note b{font-size:14px;font-weight:600}
    .note span{font-size:12px;color:color-mix(in srgb,var(--ink) 60%,transparent)}
    .note.n1{background:var(--note-yellow)}
    .note.n2{background:var(--note-pink);margin-left:28px}
    .note.n3{background:var(--note-blue);margin-left:10px}

    /* Timeline: segmented tracks, filled in the colours the real timeline uses,
       and one row that says it does not know. No figures anywhere. */
    .tl{width:100%;display:flex;flex-direction:column;gap:18px}
    .tl .row{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:14px;font-size:12px;font-weight:500;color:var(--ui)}
    .track{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px}
    .blk{height:20px;border-radius:7.64px;background:linear-gradient(90deg,var(--fill,var(--ph)) var(--f,0%),var(--ph) var(--f,0%))}
    .tl .unk{margin-top:4px;align-self:flex-start;padding:7px 14px;border-radius:20px;background:var(--panel);font-size:12px;color:var(--ui)}
    section.alt .tl .unk{background:var(--ph)}
    .tl .unk b{font-weight:600;color:var(--ink)}

    /* Linking: the idea that ties them together. */
    .links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:28px}
    .lk{background:var(--panel);border-radius:20px;padding:26px 26px 28px}
    .lk .sample{font-family:var(--script);font-size:17px;margin-bottom:12px}
    .lk .sample span{padding:1px 2px;border-radius:3px;background:color-mix(in srgb,var(--c) 26%,transparent)}
    .lk h3{font-size:16px;margin:0 0 6px;display:flex;align-items:center;gap:8px}
    .lk p{font-size:14px;line-height:1.55;color:var(--ui);margin:0}
    .note-line{font-size:15px;line-height:1.6;color:var(--ui);max-width:44em;margin:0}
    @media (max-width:860px){.links{grid-template-columns:minmax(0,1fr)}}

    /* The rest, smaller. */
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px}
    .card{background:var(--bg);border-radius:20px;padding:24px 24px 26px}
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

  // The drawing beside each pillar. Shapes and words only, no figures.
  #visual(kind) {
    if (kind === 'script') {
      return html`<div class="page" aria-hidden="true">
        <div class="pn">1.</div>
        <div class="sl">Int. Kitchen - Day</div>
        <div class="act">Ana <span class="g">pours coffee</span> and watches the rain on the window.</div>
        <div class="cue">Ana</div>
        <div class="par">(quietly)</div>
        <div class="dlg">It <span class="p">never whistles</span> when I <span class="a">watch it</span>.</div>
      </div>`;
    }
    if (kind === 'boards') {
      return html`<div class="strip" aria-hidden="true">
        <figure class="frame"><div class="shot fin"><i class="pill">Final</i></div><figcaption>Ana pours coffee.</figcaption></figure>
        <figure class="frame"><div class="shot ref"><i class="pill">Reference</i></div><figcaption>She watches the rain.</figcaption></figure>
        <figure class="frame"><div class="shot"></div><figcaption>The kettle whistles.</figcaption></figure>
        <figure class="frame"><div class="shot fin"><i class="pill">Final</i></div><figcaption>Rain falls on the road.</figcaption></figure>
      </div>`;
    }
    if (kind === 'refs') {
      return html`<div class="notes" aria-hidden="true">
        <div class="note n1"><b>Location notes</b><span>Note, linked to the script</span></div>
        <div class="note n2"><b>Costume reference</b><span>Image</span></div>
        <div class="note n3"><b>Lighting study</b><span>Link, with a preview</span></div>
      </div>`;
    }
    const track = (fills, colour) => html`<div class="track">${fills.map((f) => html`<i class="blk" style="--f:${f}%;--fill:var(${colour})"></i>`)}</div>`;
    return html`<div class="tl" aria-hidden="true">
      <div class="row"><span>Storyboarded</span>${track([100, 100, 55, 0, 0, 100, 0, 0], '--board-strong')}</div>
      <div class="row"><span>Sourced</span>${track([100, 0, 100, 0, 40, 0, 0, 0], '--res')}</div>
      <div class="unk"><b>Running time:</b> unknown until it can be worked out</div>
    </div>`;
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

      ${PILLARS.map((p, i) => html`
        <section class=${i % 2 ? 'alt' : ''} id=${i === 0 ? 'features' : ''}>
          <div class="wrap pillar ${i % 2 ? 'flip' : ''}" style="--c:var(${p.color})">
            <div>
              <div class="tag"><span class="dot" style="background:var(${p.color})"></span>${p.tag}</div>
              <h2>${p.title}</h2>
              <p class="lede">${p.lede}</p>
              <ul>${p.points.map((t) => html`<li>${t}</li>`)}</ul>
            </div>
            <div class="vis">${this.#visual(p.visual)}</div>
          </div>
        </section>
      `)}

      <section>
        <div class="wrap">
          <h2>Everything is linked to the line</h2>
          <p class="sub">Every storyboard, reference and comment is attached to the exact words it belongs to, and the words show it.</p>
          <div class="links">
            ${LINKS.map(([color, name, text, sample]) => html`
              <div class="lk" style="--c:var(${color})">
                <div class="sample"><span>${sample}</span></div>
                <h3><i class="dot" style="background:var(${color})"></i>${name}</h3>
                <p>${text}</p>
              </div>
            `)}
          </div>
          <p class="note-line">Where a line carries more than one, the colours blend. Click the words and everything attached to that line opens in one place.</p>
        </div>
      </section>

      <section class="alt">
        <div class="wrap">
          <h2>And everything around it</h2>
          <p class="sub">The rest of what keeps a project moving, from finding things to sharing them.</p>
          <div class="grid">
            ${MORE.map(([tag, color, title, body]) => html`
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

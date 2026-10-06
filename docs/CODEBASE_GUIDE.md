# Codebase guide

An orientation to the whole repo: the tooling, the layering, and how each
subsystem works. Written for someone with solid JavaScript, functional
programming and CSS, including native web components, but new to Vite, Bun, Lit
and CodeMirror 6.

Companion to `CLAUDE.md`, which owns the project's rules and its decision log,
and to `docs/FEATURE_ARCHITECTURE.md` and `docs/BACKEND_ARCHITECTURE.md`, which
own the feature designs and the server. This file owns the "what is this and how
does it fit together" view. Every hard rule in `CLAUDE.md` applies here.

---

## 1. The tooling

### Bun

Bun is a JS runtime (like Node) plus a package manager plus a test runner, in
one binary. It does two jobs here.

**Package manager.** `bun install` reads `package.json` and writes `bun.lock`.
Never run `npm install` in this repo: it would add a competing
`package-lock.json`.

**Runtime for the backend.** Everything under `server/` is TypeScript, and Bun
executes `.ts` files directly. No compile step, no `tsc` build, no ts-node.
`bun src/index.ts` just runs.

One trap worth burning in: **`bun test` is not `bun run test`**. `bun test` runs
Bun's own native test runner. `bun run test` runs the `test` script in
`package.json`, which is `vitest run`. The frontend tests are Vitest and will
not work under Bun's runner. The backend tests are the opposite: they use
`bun:test`, which Vitest cannot resolve, which is why `vite.config.js` excludes
`server/**`.

### Vite

If the mental model of a build tool is webpack (a config file, loaders, a
bundle), Vite inverts it. There are two completely different modes.

**Dev (`bun run dev`)**: there is no bundle. Vite starts an HTTP server and
serves the source files as native ES modules, transformed individually, on
demand. The browser walks the module graph. In `index.html`, the
`<script type="module" src="/src/main.js">` is literal: the browser requests
`/src/main.js`, Vite hands back that one file (rewriting bare imports like
`from 'lit'` into real URLs like `/node_modules/.vite/deps/lit.js`), and the
browser requests the next one. Change a file and only that module is re-sent
(HMR). This is why the dev server starts instantly regardless of project size.

**Prod (`bun run build`)**: now it bundles, using Rollup underneath,
tree-shaking and hashing into `dist/`. Two different engines, which is worth
knowing: dev-only bugs are possible, though rare.

Four Vite behaviours this repo leans on:

1. **`index.html` is the entry point, not an output.** Vite reads the HTML as
   the root of the graph. There is no template that gets a bundle injected into
   it; there is a real HTML file whose `<script>` tags Vite rewrites at build
   time.
2. **HTML env substitution.** `%VITE_GA4_MEASUREMENT_ID%` in `index.html` is
   replaced at build time from the env files. Only variables prefixed `VITE_`
   are ever exposed to client code; everything else stays server-side by design.
3. **`import.meta.env`.** The JS equivalent. `src/data/session.js` reads
   `import.meta.env.VITE_API_BASE`. There is no `process.env` in the browser;
   `import.meta` is the standard ESM metadata object, and Vite statically
   replaces these at build time. Env files: `.env.example`, `.env.local` (dev),
   `.env.production`.
4. **`publicDir`.** Everything in `public/` is copied to `dist/` verbatim, no
   hashing, no processing. That is where `public/_redirects` lives (a Cloudflare
   Pages file that makes `/login` fall back to `index.html`, so SPA routing
   works) and where the fonts live.

Note how small `vite.config.js` is: about 20 lines, mostly comments. That is the
point, versus a webpack config.

### Vitest

Vitest is a test runner that reuses Vite's transform pipeline. Practical
consequence: tests resolve imports exactly as the app does, so there is no
separate Babel or Jest `moduleNameMapper` config to keep in sync. The API is
Jest-shaped (`describe` / `it` / `expect`), imported explicitly rather than
injected as globals:

```js
import { describe, it, expect } from 'vitest';
```

27 test files, colocated beside the modules they cover (`src/data/merge.test.js`
next to `src/data/merge.js`). They test **only pure modules**. No jsdom, no
component rendering, no DOM. That is deliberate: the tests are fast and never
flaky, and it is a large part of why the pure/impure split below is enforced so
hard.

One thing that is **not** set up: `bun run lint` is `eslint src`, but there is no
ESLint config file in the repo, so that script currently fails.

---

## 2. The shape of the repo

```
index.html              the real entry point
vite.config.js
package.json            frontend deps (lit, codemirror, @lit/context)
bun.lock

pandemonium_1.html      88KB. The ORIGINAL app, one single static file.
                        Kept as a reference until the migration is verified
                        against it. Not loaded by anything.

src/
  main.js               about 30 lines. Bootstraps and appends <pandemonium-app>
  styles/               tokens.css, global.css, fonts.css, shared.js
  utils/                leaf-level helpers, no app knowledge
  fountain/             the screenplay parser. PURE
  data/                 the data model, reducers, persistence adapters. PURE
                        (except the adapters, which do IO)
  state/                the store, selectors, Lit-context wiring
  app-root/             the shell: app element, topbar, panel layout, timeline
  components/           everything else, grouped by feature
    ui/                 design-system primitives (pd-button, pd-menu, pd-dialog)
    editor/             CodeMirror. The biggest, hardest subsystem
    boards/ research/ sound/ slideshow/ linking/ collab/ auth/ landing/
    search/ print/ beta/
  config/               feature flags

server/                 the backend. Bun + Hono + TypeScript. SQLite dev / Postgres prod
functions/              one Cloudflare Pages Function (edge link previews)
docs/                   BACKEND_ARCHITECTURE.md, FEATURE_ARCHITECTURE.md,
                        DEPLOYMENT.md, this file
CLAUDE.md               78KB. The project's decision log. Read it for "why"
```

144 JS files, about 26,500 lines, 43 custom elements.

**The layering is strict, and it is the single most useful thing to
internalise:**

```
utils/          no app knowledge, no imports from above
fountain/       pure functions over text. No DOM. No store.
data/           pure reducers over the project object. No DOM. No Lit.
state/          the store. EventTarget. No DOM. No Lit (except context.js)
components/     Lit. The only layer that touches the DOM.
```

Nothing in `fountain/` or `data/` imports Lit or touches `document`. That is why
they are testable in milliseconds, and why the store's own header calls it
"framework-agnostic on purpose".

---

## 3. Lit

Native web components knowledge transfers directly: `customElements.define`,
shadow DOM, slots, and the fact that CSS rules do not cross a shadow boundary
but custom properties do. Lit is a small layer that fixes the three things that
make raw web components painful.

Here is a complete component, `src/components/ui/button.js`, trimmed:

```js
import { LitElement, html, css } from 'lit';

export class PdButton extends LitElement {
  static properties = {
    variant: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    icon: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host{display:inline-flex}
    button{ height:24px; color:var(--ui); background:var(--btn-bg); }
  `;

  render() {
    return html`<button ?disabled=${this.disabled} @click=${this.#onClick}>
      <slot></slot>
    </button>`;
  }
}
customElements.define('pd-button', PdButton);
```

### `static properties`

This generates, for each key: an entry in `observedAttributes`, an accessor pair
that converts between the attribute string and the typed property, and a call
into the update scheduler on set. So `el.variant = 'dark'` schedules a
re-render, and so does `<pd-button variant="dark">`.

Three modifiers matter:

- `reflect: true` writes the property **back** to the attribute. That is what
  lets the CSS use attribute selectors on the host:
  `:host([variant=dark]) button { ... }`. This pattern is everywhere in
  `src/components/ui/`.
- `{ state: true }` is internal-only: no attribute, no reflection, but setting
  it still re-renders. Used for private UI state, for example
  `_mode: { state: true }` in `src/components/boards/boards-panel.js`.
- `{}` (bare) is a reactive property with no type conversion.

This project **does not use decorators**. Upstream Lit docs show
`@customElement` and `@property`, which need a TypeScript or Babel transform.
The equivalent here is always `static properties` plus an explicit
`customElements.define`. Snippets copied from lit.dev need converting.

### `html` (lit-html)

The part worth genuinely understanding, because it explains both the performance
and some gotchas.

A tagged template literal gives the tag function two things: the array of
**static** strings, which is identity-stable (the same array object on every
call from that call site), and the interpolated values. lit-html uses that: on
first render it joins the static parts with marker comments, parses the result
into a `<template>` once, caches it keyed on the strings array, then clones it
and remembers the exact DOM positions of the dynamic holes. On re-render it only
walks those holes, and only touches the ones whose value changed.

So: no virtual DOM, no diffing pass, no reconciliation heuristics. It knows
structurally where the dynamic bits are, because the template literal told it.

Binding syntax, all of it:

```js
html`
  <div class=${cls}>            plain ${} in attribute position: attribute
  <input .value=${v}>           .  property, not attribute
  <button ?disabled=${d}>       ?  boolean attribute (present/absent)
  <button @click=${this.#fn}>   @  addEventListener, `this` auto-bound
  ${items.map(i => html`<li>${i.name}</li>`)}   nested templates, arrays fine
`;
```

The gotcha that follows from the caching: **the template's structure must be
stable across renders.** A tag name cannot be interpolated, and the template
string cannot be built dynamically. `html\`<${tag}>\`` is not a thing.
Conditionals return whole different templates instead:

```js
render() {
  return this.loading ? html`<pd-spinner></pd-spinner>` : html`<div>${this.data}</div>`;
}
```

One further consequence, hit twice in this codebase: lit-html tracks its holes
with **marker comment nodes in the DOM**. If something else mutates that DOM
underneath it, the markers get disturbed and lit loses its place. A
`contenteditable` is exactly that something, because the browser restructures
nodes as you type. The fix used here is the `keyed()` directive, which forces a
full remount of a subtree when its key changes. See the slideshow's in-place
line editing and the references reader (`CLAUDE.md` items 12 and 16).

### `static styles` and `css`

The `css` tag builds a `CSSStyleSheet` once per class, and Lit puts it into the
shadow root via `adoptedStyleSheets`: one sheet object shared by every instance,
parsed once. Composition is array spreading:

```js
static styles = [panelStyles, chipStyles, css`
  .shell{position:relative}
`];
```

where `panelStyles` comes from `src/styles/shared.js`. Section 7 covers why that
file has to exist.

### The update lifecycle

Updates are **async and batched**, unlike a naive web component where a setter
does work immediately.

```
property set  ->  requestUpdate()  ->  (microtask)  ->  shouldUpdate()
                                                     ->  willUpdate()
                                                     ->  render()
                                                     ->  firstUpdated() / updated()
                                                     ->  updateComplete resolves
```

Set five properties in one function and the result is one render. To touch the
DOM after a render, `await this.updateComplete` or work in `updated()`. Both
appear in the editor and panel code.

### ReactiveController

A small object protocol: anything with `hostConnected` / `hostDisconnected` /
`hostUpdate` hooks, registered via `host.addController(this)`, which then
participates in the host's lifecycle. It is Lit's answer to "reusable stateful
behaviour without a base class or a mixin" (the role React hooks play, minus the
magic). This repo has exactly one, and it is the central nervous system:
`StoreController`.

---

## 4. State management

Three files, and they fit together neatly.

### `state/store.js`: one object, two branches

A single `PandemoniumStore extends EventTarget`. Not a library. No Redux, no
signals, no observables. Just:

```js
export class PandemoniumStore extends EventTarget {
  #project = null;   // PERSISTED. Saved, synced, merged, exported.
  #ui = null;        // TRANSIENT. Never saved.
  get project() { return this.#project; }
  get ui() { return this.#ui; }
}
```

The `project` / `ui` split is load-bearing, not cosmetic. `project` is literally
what gets written to `.pandemonium.json` and POSTed to the server. `ui` holds
the active draft, open dialogs, a link-in-progress, the focused pane, an
in-flight merge. `ui.merge` is transient **by design**, so a half-resolved merge
can never autosave (`CLAUDE.md` item 6).

Every mutation funnels through one of two private methods:

```js
#applyProject(next) {
  if (!this.#restoring) this.#history.record(this.#project, next);
  this.#project = next;
  this.#ui = { ...this.#ui, dirty: true };
  this.#emit('project');
}

#applyUI(next) { this.#ui = next; this.#emit('ui'); }
```

and every public action is a one-liner delegating to a pure reducer:

```js
deleteBoard(id) { this.#applyProject(model.deleteBoard(this.#project, id)); }
setBoardNote(id, note) { this.#applyProject(model.setBoardNote(this.#project, id, note)); }
```

So all the *logic* lives in pure functions in `data/`, and the store is a thin
stateful shell that holds the current value, records history, and fires a
`change` event. It is a reducer architecture where the store is the only mutable
cell.

`#emit()` dispatches a DOM `change` event. That is the entire subscription
mechanism, built on a platform API.

### `state/context.js` plus `state/store-controller.js`: delivery

The problem: the topbar, each panel, every card and every popover all need read
and write access to the same store, and they are five or six levels deep.
Passing a prop down through every layer would be miserable.

`@lit/context` solves it with an event protocol (a community protocol, not
Lit-specific):

1. A consumer dispatches a `context-request` event, bubbling and composed,
   carrying a context key and a callback.
2. The nearest ancestor providing that key catches it, calls the callback with
   the value, and stops propagation.
3. If the consumer asked with `subscribe: true`, the provider keeps the callback
   and calls it again whenever the value changes.

Declaring a context is one line, in `src/state/context.js`:

```js
export const storeContext = createContext('pandemonium-store');
```

The provider is on the app root (`src/app-root/pandemonium-app.js`):

```js
this.store = new PandemoniumStore();
this._provider = new ContextProvider(this, { context: storeContext, initialValue: this.store });
```

The consumer side is wrapped into `src/state/store-controller.js`, which
combines the context lookup with the store subscription:

```js
export class StoreController {
  constructor(host) {
    this.#boundOnChange = () => host.requestUpdate();
    this.#consumer = new ContextConsumer(host, {
      context: storeContext, subscribe: true,
      callback: (store) => this.#onStore(store),   // attaches the 'change' listener
    });
    host.addController(this);
  }
  get store()   { return this.#consumer.value; }
  get project() { return this.store ? this.store.project : null; }
  get ui()      { return this.store ? this.store.ui : null; }
}
```

So **every panel component is this shape**:

```js
export class PandemoniumBoardsPanel extends LitElement {
  constructor() {
    super();
    this.ctl = new StoreController(this);     // one line, and it is wired
  }
  render() {
    const { project, ui } = this.ctl;         // read
    return html`<button @click=${() => this.ctl.store.deleteBoard(id)}>Delete</button>`;
  }                                           // write
}
```

Read from `ctl.project` / `ctl.ui` in render, call `ctl.store.someAction()` to
mutate, and any store change re-renders automatically. No component keeps its
own copy of app state.

There is one documented exception, worth knowing because the failure is silent:
**`pandemonium-app` must not use `StoreController` on itself.** `@lit/context`
deliberately refuses to satisfy a `context-request` dispatched by the provider's
own host element, to stop a provider self-registering as its own consumer, so it
would never resolve. The app root holds the store directly and calls
`addEventListener('change', ...)` itself. The comment at the top of
`store-controller.js` explains it.

### `state/selectors.js`: derived state

The pure derivations: which anchors currently resolve, which scene each falls
in, coverage fractions, slide plans, sound rulers. Four or five panels need the
same answers on every render, so the store memoizes the expensive bundle on
**object identity**, not a deep compare:

```js
getFinalState() {
  const cache = this.#finalStateCache;
  if (cache && cache.project === this.#project && cache.ui === this.#ui) return cache.result;
  // ... recompute, cache, return
}
```

This is exactly why `#applyProject` replaces the project object rather than
mutating it, and why the reducers in `data/` are careful about identity.
Immutability here is not dogma, it is what makes `===` a valid cache key.

### Three small satellites

Not everything belongs in the store, and the reasoning is explicit in each file:

- `src/state/theme.js`: light / dark / system. `EventTarget`, same shape as the
  store, persisted to `localStorage`. Theme is per **user**; panel layout is per
  **project** (so layout lives in `project.layout` and syncs, and theme does
  not).
- `src/state/active-panel.js`: which pane was last clicked in, for routing
  Cmd+Z. A plain module-level variable, explicitly kept *out* of the store,
  because it changes on every click and in the store that would re-render every
  panel including CodeMirror on every click. Nothing renders from it; the
  keyboard handler reads it at the moment a key is pressed.
- `src/state/history.js`: undo and redo, one thread per panel. A thread is
  defined by which project branches it owns (`boards`, then
  `research` + `folders` + `links`, then `sounds` + `tracks` + `clips`), so a
  change is recorded on the thread of the **data it touched**, not the panel it
  was made from. An entry is just the previous branch references, which is free
  precisely because every reducer is pure.

---

## 5. The pure core

### `src/fountain/`: the parser

Fountain is a plain-text screenplay format: `INT. HOUSE - DAY` is a scene
heading, an all-caps line is a character cue, `> FADE OUT:` is a transition,
`.FORCED` forces a heading, `[[ ]]` is a note, `/* */` is a boneyard (commented
out), `#` is a section, `===` is a page break.

`parse.js` is hand-rolled, about 160 lines, and is the single source of truth
for what the document means. `parseFountain(src)` returns `{ title, blocks }`
where each block is:

```js
{ type: 'action', text: 'She **runs**.', line: 42, textOffset: 0, scene: 3, i: 17,
  runs: [...], plain: 'She runs.', words: 2, plainToRaw: [0,1,2,3,4,6,7,8,9] }
```

The part that takes a minute to appreciate is that there are **three coordinate
systems**, and `plainToRaw` is the bridge:

1. **Raw document offsets.** What CodeMirror edits: `She **runs**.`
2. **Block-relative `text` offsets.** `block.line` plus `block.textOffset`
   locates a block in the raw document.
3. **`plain` offsets.** Markup delimiters stripped: `She runs.`

Highlight anchors are always stored in **plain** coordinates, so adding or
removing `**bold**` around a linked phrase does not sever the link.
`plainToRaw[p]` gives the raw offset of `plain[p]`, and `doc-map.js` converts in
both directions.

Two bug fixes in this file read well as case studies, both documented inline:

- **`maskBoneyard`**: the boneyard used to be *cut out* of the string before
  splitting into lines, so every block after a multi-line `/* */` reported a
  line number too low. The editor formatted the wrong lines, pagination counted
  the wrong rows, and every anchor below it resolved to the wrong characters. It
  is now blanked **in place**: every character becomes a space, every newline is
  kept, so nothing moves.
- **Forcing marks tested first**: `!` and `~` used to be tested *after* the
  `INT./EXT.` and `TO:` heuristics, so `!CUT TO:` parsed as a transition. Since
  `!` is exactly what the element picker writes to say "this is action", the
  picker could not convert a heading back to action at all.

The rest of the folder:

- `blocks.js`: scene grouping and the runtime estimate. Note
  `sc.secs = sc.scripted ? Math.max(2, sc.dw / 2.4 + sc.aw / 4.5) : 0` and the
  comment above it: an empty scene heading used to get a flat 2 seconds, which
  inflated the estimate by exactly the amount of script not yet written. Hard
  rule 3 in practice.
- `resolve.js`: **the anchor scheme.** A link is stored as
  `{q: quoted text, b: block index, s: offset}` and re-found by *searching for
  the quote*, starting at block `b` and expanding outward. Never a fixed range.
  This is what lets an edit anywhere in the document not sever links.
  `snapToWords` grows a range to word boundaries so a link reads word to word.
  The header says explicitly: do not change this to offset-based anchoring.
- `cache.js`: memoizes parses keyed on text identity, and dispatches to the
  right parser per draft format.
- `plain.js`: the *other* parser. One block per non-blank line, every one a
  paragraph, nothing read in. Used for plain-text and Markdown drafts. Reason
  (`CLAUDE.md` item 33): a first draft is usually prose, and read as Fountain
  that prose is silently rewritten in front of the writer.
- `paginate.js`: pure page layout. A 57x58 character grid on A4, 60x54 on
  Letter, indents, keep-with-next, page numbers. `displayLines` derives what
  each line is *drawn* as (concealed markup removed), so pagination counts drawn
  characters rather than raw ones.
- `stress.test.js`: 400 generated documents plus a torture file, asserting the
  invariants (the boneyard never shifts a column, every block sits on its real
  line, no page holds more rows than a page has).

### `src/data/`: the model

`schema.js` is the persisted shape, and its header is a warning: this exact
shape is in every `.pandemonium.json` already saved, so renaming a field is a
breaking change. That is also why `CLAUDE.md` item 21 renamed "Research" to
"References" in all UI copy but deliberately left `project.research`,
`link.researchId` and the `'research'` panel type alone.

`project-model.js` is about 600 lines of pure reducers,
`(project, ...args) => newProject`. The header states the performance contract
precisely:

> Every reducer shallow-clones only the branch it touches [...] and leaves every
> other record referentially identical. Boards can carry multi-megabyte data-URL
> images in `img`; a plain object/array spread only copies the reference to that
> string, not its contents, so this stays cheap. Never JSON-round-trip or
> `structuredClone()` the whole project for a single-field edit.

That is two constraints at once: identity preservation for the memo cache, and
not copying megabytes of base64 on every keystroke.

Also in here:

- `merge.js`: a three-way, git-shaped merge. Split by data shape, which is what
  makes it tractable without a CRDT. **Scripts** get a line-level diff3 (regions
  only one side touched merge silently, regions both touched conflict).
  **Id-keyed collections** merge as sets. **Anchors are deliberately not merged
  at all**, because `resolve.js` re-searches quoted text, so a link finds its
  passage after a merged edit for the same reason it survives a local one.
  **Project meta** merges field-wise, with mine winning. The header calls this
  the highest-risk code in the repo, which is why it is pure and heavily tested.
- `layout-tree.js`: the panel layout, a binary split tree (the Blender and
  react-mosaic model). `leaf: {id, type:'leaf', content}` or
  `split: {id, type:'split', dir:'row'|'col', ratio, a, b}`. All helpers pure,
  returning new trees.
- `audio-model.js`: three flat id-keyed collections (`sounds`, `tracks`,
  `clips`) rather than one nested tree, specifically so the three-way merge
  handles them as sets. A clip is anchored as `boardId` plus `offset`, meaning
  "this far into *that* storyboard", never an absolute time, so sound follows the
  beat it was cut against when pacing changes.
- `db.js` plus three adapters: the persistence seam, covered in section 9.

---

## 6. The component tree

### Bootstrap

`src/main.js` is about 30 lines: import the global CSS, init analytics, call
`theme.init()` *before* mount (so the first paint is already dark on a dark
desktop, with no white flash), create `#printRoot` as a direct child of `<body>`,
then append `<pandemonium-app>`.

The `#printRoot` arrangement is a shadow DOM constraint. PDF export is
`window.print()`, and the print stylesheet in `global.css` says
`body > *:not(#printRoot) { display: none !important }`. For that to work,
`#printRoot` must be a **sibling** of the app, not inside it: if it lived in any
component's shadow root, hiding that component would hide the print content with
it. So it is created imperatively in light DOM.

### `pandemonium-app`: the shell

`src/app-root/pandemonium-app.js` does five things:

1. Owns the single store instance and provides it via context.
2. Picks the screen via `gate.js`: `boot`, `landing`, `login`, `start`, `app`.
   `screenFor` is a pure, tested function, so the "an account is required" rule
   lives in one place instead of being smeared across render and boot code.
3. Owns the address bar (`pushState`, `popstate`), so Back works on the way in.
4. Runs the debounced autosave.
5. **Hosts the overlay layer**: toast, dialog, menu, selection toolbar, linkbar,
   link popover, comment popover, confirm host, slideshow, connector line. All
   mounted as direct children of app-root.

That last point is the second shadow DOM consequence. A floating popover
anchored to a selection inside a CodeMirror instance inside a panel inside a
split tree cannot be rendered where the selection is: it would be clipped by
every `overflow: hidden` ancestor and trapped in a shadow root. So it is
rendered at the top and positioned from a reported rect.

Which leads to the communication pattern. `src/utils/events.js` is the whole
thing:

```js
export function dispatch(el, name, detail) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
```

`composed: true` is the key: without it, an event stops at the shadow boundary.
With it, a deeply nested card can
`dispatch(this, 'pandemonium-toast', { message })` and app-root catches it, with
no component holding a reference to any sibling and nobody reaching into
anybody's shadow tree. Store mutations go through the store; *imperative
requests* ("show a toast", "open this menu at this rect") go through composed
events.

One gotcha follows: on a composed event, `event.target` is **retargeted** to the
shadow host, so a document-level handler cannot tell what was really clicked.
`event.composedPath()` is needed. This bit the project twice, both times a
document keydown handler eating keys while a line editor was focused, and both
fixes are noted in `CLAUDE.md` items 12 and 16.

### `panel-layout`: the Blender split tree

`src/app-root/panel-layout.js` recursively renders `project.layout`: each split
is a flex row or column of two panes with a draggable divider, and each leaf is
a panel component chosen by its `content` string. Dragging a divider changes
`ratio`; dragging a corner splits or merges. Every operation is a pure tree
transform from `layout-tree.js`, dispatched to the store, which persists it with
the project.

`src/app-root/timeline.js` draws the three coverage rows (Storyboard,
Reference, Sound) from the selectors.

### Panels

Six panel types: `script`, `boards`, `research`, `sound`, `timeline`, `status`.
Each is a Lit element with a `StoreController`, reading derived state from
selectors and writing through store actions.
`src/components/boards/boards-panel.js` is the most representative one to read
first: panel chrome, a toolbar, a list of cards, drop handling, and a mode
switch.

Note the lazy-loading pattern in `src/components/editor/script-panel.js`: the
panel chrome (header, draft tabs, word count) is one component, and the actual
editor is a *separate* component imported on demand rather than at module scope,
because it pulls in all of CodeMirror and the default layout has no script leaf
at all.

### `components/ui/`: the design system

16 primitives, all prefixed `pd-`: `pd-button`, `pd-menu`, `pd-dialog`,
`pd-segmented`, `pd-toast`, `pd-project-card`, `pd-confirm-bubble`. Each maps to
a named Figma node, cited in the file header ("Figma
Button-Standard-Component, node 21:69"). They are the only place a visual
decision is made twice, so a design change means changing one file.

`confirm.js` plus `confirm-host.js` plus `confirm-place.js` are a good small
example of the house style: an `askConfirm()` promise API, one host at app-root
that owns Escape and outside-click, and the placement maths extracted into a
pure tested function.

---

## 7. Styling

The whole system is built on one shadow DOM asymmetry:

> **Custom properties inherit through shadow boundaries. Ordinary rules do not.**

So the architecture is:

**`src/styles/tokens.css`** declares about 124 custom properties on `:root`, and
a second set under `:root[data-theme="dark"]`. Because they are inherited, every
one of the 43 shadow roots in the app sees all of them for free, with zero
imports and zero per-component work. `theme.js` switches themes by writing a
single attribute on `<html>`, which re-themes the entire app instantly.

The direct consequence, stated as a rule: **never hardcode a colour in a
component.** A literal hex is a hole in the dark theme, and because rules do not
inherit, nothing can reach into a shadow root later to correct it. Two
exceptions are deliberate and documented where they live: the slideshow (always
a lights-down surface) and the print block (always paper).

**`src/styles/shared.js`** exists because of the other half of that asymmetry. A
global stylesheet cannot style an `<input>` inside a shadow root, so shared
*rules* are exported as Lit `css` fragments (`formStyles`, `chipStyles`,
`panelStyles`, `avatarStyles`) and spread into each component's `static styles`
array. It is the one place those rules are defined; the cost is remembering to
import them.

**`src/styles/global.css`** is the light-DOM-only layer: reset, `body`,
`::selection`, and the large print block.

Two details worth noticing while reading: the radii are a golden-ratio series
(20px pill, 20/1.618 = 12.36px frames, 7.64px tracks, 4.72px page corners), and
`src/utils/motion.js` provides fade, crossfade, FLIP and spring helpers driven by
`--dur-*` and `--ease-*` tokens that are **zeroed under
`prefers-reduced-motion`**, so reduced motion is handled once at the token level
rather than per animation.

---

## 8. The editor (CodeMirror 6)

The steepest part of the codebase, about 3,000 lines across
`src/components/editor/`, and steep because CodeMirror 6 has an unusual
architecture. Worth learning properly: it is functional, so it should click
fast.

### The CM6 model

**`EditorState` is immutable.** It is never mutated. A `Transaction` describing
changes is dispatched, and a new state comes back. `EditorView` renders a state
to the DOM. One-way data flow.

```js
view.dispatch({ changes: { from, to, insert: 'text' } });   // new state, then re-render
```

Everything else is an **extension**, and five kinds appear in this folder:

| Kind | What it is | Where |
| --- | --- | --- |
| **Facet** | A configuration value combined from many providers | `cm-format.js`: which format to parse as |
| **StateField** | An immutable state slice, mapped through doc changes | `cm-pages.js` page layout, `cm-sections.js` hover, `cm-case-journal.js` |
| **ViewPlugin** | View-level, can read the viewport, builds decorations | `cm-fountain-plugin.js`, `cm-markdown.js`, `cm-script-minimap.js` |
| **StateEffect** | A typed side-channel message inside a transaction | `setHoverSection`, `setPageMetrics`, `setElementMenu` |
| **keymap / theme** | Bindings and CSS | `cm-theme.js`, `cm-emphasis.js` |

**Decorations** are how appearance changes without the text changing. Four
types, and the distinction matters here:

- `Decoration.mark` wraps a range in a span (emphasis, link colours, concealing
  syntax)
- `Decoration.line` puts a class on a line (the hover band, element formatting)
- `Decoration.widget` inserts DOM at a position
- `Decoration.replace` hides a range (how Fountain's `.`, `@` and `**` markers
  get concealed)

And a rule that shapes `cm-pages.js` directly: **a decoration that changes
vertical layout (a block widget) must come from a StateField, not a
ViewPlugin.** CodeMirror needs the height map before it decides the viewport, so
a view plugin is too late. That is why that file is split in two: `pagesField`
(a StateField that turns every page break into a block widget exactly as tall as
the remaining page) and `pageSheets` (a background layer that only paints).

### What this editor does with it

The central guarantee: **the document text is never rewritten for display.**
Everything visual is a decoration layer over the raw Fountain. That makes hard
rule 2 structural rather than aspirational.

- **`cm-fountain-plugin.js`**: makes raw Fountain *look* like a formatted
  screenplay. It calls the same `parseFountain()` the rest of the app uses, never
  a second grammar, so the editor and the timeline cannot disagree about what a
  line is. It also does the Obsidian-style live preview: the syntax marking an
  element is **hidden** on lines the caret is not on and merely **dimmed** on the
  line being edited. "Being edited" is just "a selection range touches this
  line", so it recomputes on selection change, not only on edits.
- **`cm-autoformat.js`**: format as you go. Scene headings and transitions
  upper-case their own text as you type. Setting an element "pins" it to the
  line. Tab cycles elements, Enter moves to the next one. The clever part:
  upper-casing runs as a **`transactionFilter`**, so it rides along in the *same
  transaction* as the keystroke. One undo step, and the caret never jumps,
  because the edit is length-preserving.
- **`cm-case-journal.js`**: two StateFields keyed by line position that remember
  what a line said before an element transform, so Shift+Tab can revert casing
  *and* markup in one step. `caseExempt` is the second field, because without it
  the next keystroke re-upper-cases the just-reverted line and the revert looks
  like it never happened.
- **`cm-pages.js`**: real A4 and Letter sheets. Geometry arrives by **effect**
  (`setPageMetrics`), so changing the text size rescales the page without moving
  a single page break, because the layout is in characters and rows, not pixels.
  The `textBlockAt` helper exists because `lineBlockAt` returns a *composite*
  whose `type` is an array of blocks; taking the last entry grabbed the
  end-of-document filler on the last page and drew the sheet far below its own
  text (`CLAUDE.md` item 31).
- **`element-menu.js`**: the Final Draft element picker, hand-rolled rather than
  built on `@codemirror/autocomplete`, because it is not completing what was
  typed (there is nothing on the line), it is a fixed chooser. The fix in
  `shortcutForKey` is a good one: only a plain lowercase letter counts as a
  shortcut now, because case-insensitive matching meant typing "She " on a fresh
  paragraph had its "S" eaten as a menu shortcut and the line rewritten as a
  scene heading.
- **`selection-capture.js`**: converts a CodeMirror selection (raw offsets) into
  the `{q, b, s}` anchor shape, the inverse of `doc-map.js`. This is the bridge
  between the editor and the link model.
- **Undo and anchors** (`script-editor.js`): link anchors live in the store, and
  every edit re-derives them from the text. Re-deriving forward through an undo
  is *not* the inverse of re-deriving forward through the edit, so the history
  carries the anchors as they were before each edit via `invertedEffects`, and an
  undo restores exactly those, merged by id so a board added or deleted elsewhere
  meanwhile is not resurrected or lost. Also: switching drafts builds a **fresh
  `EditorState`**, because sharing one history let Cmd+Z paste the draft just
  left into the one on screen.

To orient in this folder, read `cm-fountain-plugin.js` first. It is the smallest
complete example of "parse, decorate, never touch the text".

---

## 9. Persistence and the backend

### The seam

`src/data/db.js` is a deliberately thin interface: `saveProject`,
`openProjectFile`, `autosaveProject`, `loadAutosavedProject`,
`loadRemoteProject`, plus the sharing functions re-exported. **No component ever
imports an adapter directly.** Three adapters sit behind it:

- `local-file-adapter.js`: explicit Save (download) and Open (file picker) of a
  `.pandemonium.json`. Available in both modes, as the portable backup path.
- `local-db.js`: IndexedDB. Now only the path an old browser-local project is
  read from once, to be adopted into an account.
- `remote-api-adapter.js`: the backend.

`autosaveProject` dispatches on `session.getMode()`. That is the whole switch.
Swapping the backend for a different API, or for Firebase, means writing a fourth
adapter and changing nothing above this file.

Two details in the remote adapter: images and audio travel as **data URLs**
inside the project JSON locally, but are **lifted into an asset store** on sync
(`imgAssetId`, `refImgAssetId`), with an in-memory bidirectional cache so the
same image is not uploaded twice. And a `409` from the server opens a three-way
merge instead of retrying over the other writer.

`src/data/session.js` is the only path to the backend: mode, in-memory access
token, current user, open project id. The access token lives **in memory only**
and is lost on reload by design; continuity comes from an httpOnly refresh cookie
that `restore()` trades for a fresh access token on boot. The one durable client
breadcrumb is the last-opened project id in `localStorage`.

### The server

`server/` is **TypeScript**, run directly by Bun, with no build step. Hono is a
small, fast, Fetch-API-based web framework (Express-shaped, but built on
`Request` and `Response`, so the same code runs on Node, Bun, Deno and
Cloudflare Workers).

`server/src/app.ts` assembles the app but does not start it, so tests can drive
it with `app.request()` and `index.ts` is the only thing that listens. Routes:
`/v1/auth`, `/v1/assets`, `/v1/projects`, `/v1/projects/:id/shares`,
`/v1/link-preview`.

`server/src/schema.sql` is dialect-neutral, so it runs unchanged on SQLite (dev)
and Postgres (prod): TEXT ids, TEXT ISO timestamps, and the whole project tree as
one JSON TEXT blob. Phase A never queries inside the blob, so no jsonb is needed.
All statements are idempotent, so the file doubles as the migration.

`server/src/link-preview/` is the most security-sensitive code here and reads
well as an example: an SSRF guard on **every** redirect hop (http(s) only, no
credentials, web ports only, and every resolved address must be public,
including IPv4 hidden in `::ffff:`, NAT64 and 6to4 forms, because Oracle Cloud's
metadata service sits at 169.254.169.254), 5 redirects maximum, an 8 second
budget, a 1MB read cap, 8 concurrent upstream fetches behind a bounded queue, a
per-IP rate limit, and an LRU cache with in-flight de-duplication. 70 offline
tests in `server/test/link-preview.test.ts`.

### The edge function

`functions/api/link-preview.ts` is a **Cloudflare Pages Function**: a file-based
serverless route that deploys with the frontend. A file at
`functions/api/foo.ts` serves `/api/foo` on the app's own origin. It exists
because the API server is not deployed with the preview route and cannot be
deployed from this machine, and a preview needs no database, so it moved to where
a `git push` ships it. The core pipeline was split (`ip.ts` pure address rules,
`dns.ts` the only Node import, `lookup: null` meaning "the platform refuses
private destinations", which a Worker does) so one implementation loads in either
runtime.

---

## 10. Conventions to respect

1. **No em-dashes anywhere.** UI copy, docs, comments, commit messages. Hard
   rule 1.
2. **No TypeScript and no decorators on the frontend.** `static properties` and
   `customElements.define`, never `@customElement`. The backend is TypeScript;
   that is the line.
3. **Never hardcode a colour in a component.** Tokens only.
4. **Keep `fountain/` and `data/` pure.** No DOM, no Lit, no store. The tests
   depend on it, and so does the merge engine's trustworthiness.
5. **Do not rename persisted keys.** `project.research`, `link.researchId`, the
   `'research'` panel type. Renaming breaks saved files and synced projects.
6. **The timeline math must be honest.** If a number cannot be computed
   reliably, show it as unknown. Never fake it. Hard rule 3.
7. **`bun run test`, not `bun test`.**

One genuinely unusual thing about this codebase: **the comments explain *why*, at
length, including the bug that motivated the current shape.** That is not
decoration, it is the primary navigation aid. A file opening with 20 lines of
header comment is worth reading. `maskBoneyard`, `textBlockAt`,
`shortcutForKey`, the StoreController exception and the `composedPath` notes are
each a trap someone already fell into, documented so it is not fallen into
twice. `CLAUDE.md` is the same thing at project scale: 33 numbered batches of
what changed and why.

---

## 11. Where to start reading

In this order, which gives the whole model in about an hour:

1. `src/main.js`, then `src/app-root/pandemonium-app.js` (skim): the bootstrap.
2. `src/state/store-controller.js`, then `src/state/store.js` lines 1 to 80 and
   220 to 270: the state pattern.
3. `src/data/project-model.js` lines 1 to 60: the reducer contract.
4. `src/components/ui/button.js`: the smallest complete Lit component.
5. `src/components/boards/boards-panel.js`: a real panel end to end.
6. `src/fountain/parse.js` and `src/fountain/resolve.js`: the domain.
7. `src/components/editor/cm-fountain-plugin.js`: the editor, once the rest
   makes sense.

Then `bun install && bun run dev` and `bun run test`, to see both halves moving.

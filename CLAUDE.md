# CLAUDE.md

Project context for **Pandemonium**, a Common Genius software project.
Put this file at the repo root. Read it fully before working.

Note: an earlier version of this file framed the repo as a film brief. That was
wrong. Pandemonium is the software. A film script is only the content we test it
with.

---

## What Pandemonium is

Pandemonium is a web app for film pre-production built around the Fountain
screenplay format. It renders and edits Fountain, and it ties three things that
normally live in three separate tools into one surface:

- the script (Fountain, rendered and editable)
- the storyboard (script sections linked to images)
- the research (script sections linked to URLs, documents, and notes)

One line: write the script, board it, and back every claim with a source, in one
place, with a timeline that shows how done you actually are.

---

## Core concepts and data model

From the product spec. Confirm against the code before relying on it.

- **Script**: a Fountain document. Multiple scripts are allowed per project, but
  only one is the **final draft**, and only the final draft links to storyboards
  and research.
- **Storyboard link**: a script section connected to one or more images. Viewable
  as a board, or as a slideshow with the image on top and the linked script
  portion in the bottom fifth of the frame. Several boards may attach to one
  section; their order within that section is the board's `seq` field, since
  they all resolve to the same script position and nothing else would order
  them. A board may also be **blank** (`img: null`), created from a section
  before the frame exists. A blank board is a real link but is **not** counted
  as boarded by the timeline (see hard rule 3): the section is claimed, not
  drawn.
- **Research link**: a script section connected to a URL, a research document, or
  a note. A highlighted span inside a research doc links to a specific script
  span. Clicking either end reveals the link between the two.
- **Global timeline**: sits above everything and shows, at a glance, how much of
  the script is storyboarded, how much is backed by research, and the estimated
  video length.
- **Global search**: across scripts, storyboards, research, and notes.
- **Panel layout**: a Blender-style binary split tree of panes, each showing any
  panel type (script, storyboards, research, timeline). It is **per project**,
  not per user: a layout is part of how a given project is being worked on, so
  it lives in the persisted project and syncs with it. Theme is the opposite
  case and stays per user in localStorage.
- **Persistence**: file save and read, plus PDF export.

---

## Design language

Flat. A limited, muted color palette. No borders on shapes, solid fills only.
Screens are designed in the Figma file "Pandemonium":
figma.com/design/S7i6Jcdhx0gViHlxU7RrCz

Derive any remaining screens from that same design language. When a screen is not
yet in Figma, match the existing tokens rather than inventing new ones.

There are two themes. The light one is the Figma file. The dark one is a
midnight-working palette declared under `:root[data-theme="dark"]` in
`src/styles/tokens.css`, built for a dark room rather than derived by inverting
the light values. Because tokens are inherited CSS custom properties, both
themes reach every shadow root without a component change, so **never hardcode a
color in a component**: a literal is a hole in the dark theme. Two deliberate
exceptions are documented in place, the slideshow (always a lights-down surface)
and the print block in `global.css` (always paper).

---

## Stack and build

Not Next.js. The repo started as a single static HTML file (`pandemonium_1.html`,
kept at the root as a reference until the migration is fully verified against it)
and is being migrated to Lit web components on Vite. Confirmed against the repo
as of the migration:

- Package manager: Bun (the lockfile is `bun.lock`; use `bun install`, not npm).
  Framework: [Lit 3](https://lit.dev), plain modern JavaScript (ES modules). The
  frontend uses no TypeScript and no decorators (the author does not know
  TypeScript; components use `static properties = {...}` and
  `customElements.define(...)`, not `@customElement`/`@property`). This is a
  frontend rule only: the backend under `server/` is TypeScript (see below), run
  directly by Bun with no build step.
- Build tool: Vite, run through Bun. `bun run dev` (dev server), `bun run build`
  (production build to `dist/`), `bun run preview`, `bun run test` / `bun run
  test:watch` (Vitest, not yet populated). Use `bun run test`, not `bun test`:
  the latter invokes Bun's own native test runner and bypasses the Vitest
  script. `bun run lint` (ESLint, config not yet added).
- Styling: plain CSS custom properties as design tokens (`src/styles/tokens.css`,
  inherited through shadow DOM automatically) plus Lit `css` tagged templates
  per component. Shared form/panel/chip fragments live in `src/styles/shared.js`
  since shadow DOM does not inherit ordinary CSS rules, only custom properties.
- State management: a single framework-agnostic `PandemoniumStore`
  (`src/state/store.js`, extends `EventTarget`) holding a `project` branch
  (persisted, and now including the panel `layout`) and a `ui` branch
  (transient), delivered through the component
  tree via Lit Context (`src/state/context.js`) and a `StoreController`
  reactive controller (`src/state/store-controller.js`) that components attach
  in their constructor. Mutations go through pure reducers in
  `src/data/project-model.js`. See the note in `store-controller.js` about why
  `pandemonium-app` itself (the Context provider) reads the store directly
  rather than via `StoreController`.
- Fountain parser: hand-rolled, not a third-party library. Pure, DOM-free
  functions in `src/fountain/` (`parse.js`, `blocks.js`, `resolve.js`,
  `cache.js`), lifted from the original single file. `resolve.js` documents the
  anchor-resolution scheme (quote-search, not fixed offsets) that lets edits
  elsewhere in the document not sever existing board/research links.
- Storage backend: local by default. A project is a `.pandemonium.json` file the
  user explicitly saves (download) and opens (file picker); images and other
  embedded files are data URLs inside that JSON. All of this goes through
  `src/data/db.js`, a deliberately thin seam so an alternate backend is a second
  adapter module dropped in behind the same functions, without UI code changing.
  An initial remote backend exists under `server/` (Bun + Hono, TypeScript, with
  SQLite in dev and PostgreSQL in prod behind one query layer) implementing Phase
  A document sync, and the client seam is wired to it: `src/data/session.js` holds the account session, `src/data/remote-api-adapter.js`
  is the third adapter, and `db.js` dispatches autosave/load by mode (local
  IndexedDB when signed out, the backend when signed in). Sign-in is offered in
  the topbar and start screen. The full architecture, schema, and deployment plan
  (Cloudflare Pages plus Oracle Cloud) live in `docs/BACKEND_ARCHITECTURE.md`.
- PDF export: browser print (`window.print()`) against a dedicated light-DOM
  `#printRoot` element (see `src/components/print/print.js` and the comment
  in `src/styles/global.css` on why it must live outside every component's
  shadow root), not a PDF library.
- Test runner: Vitest, with tests alongside the modules they cover
  (`src/**/*.test.js`, e.g. `data/merge.test.js`, `data/layout-tree.test.js`,
  `state/selectors.test.js`). `src/fountain/parse.js` against every construct
  hard rule 2 lists is still the biggest open gap.

Migration is being done in phases (scaffold, feature-parity port, Figma
re-skin, unified CodeMirror-based editor, new capabilities). Check
conversation/commit history for which phase is current before assuming the
whole app matches the Figma file yet.

---

## Hard rules

1. **No em-dashes in any written material.** UI copy, docs, comments, commit
   messages. Use periods, colons, commas, parentheses, or a line break.
2. **Fountain fidelity is sacred.** The editor must round-trip Fountain without
   corrupting it: forced scene headings (leading period), centered text
   (`> text <`), notes (`[[ ]]`), boneyard (`/* */`), sections (`#`), and title
   page keys. If a parser drops or mangles any of these, that is a bug, not an
   edge case.
3. **The timeline math must be honest.** Percent storyboarded, percent
   researched, and estimated length are the product's whole promise. If a number
   cannot be computed reliably, show it as unknown. Never fake it.
4. **One final draft owns the links.** Storyboard and research links attach to the
   final draft only. Do not let other drafts silently accumulate links.

---

## Sample content

`the-shape-of-memories.fountain` is named here as the canonical test fixture,
but it does not currently exist anywhere in this repo. It is a real
screenplay with a title page, forced headings, on-screen supers, centered end
cards, notes, a boneyard reading-note, and a `[[Rn]]` reference system with a
REFERENCES block at the foot of the file.

Use it to exercise:
- the parser (it uses every Fountain construct listed in Hard Rule 2)
- research linking (its `[[Rn]]` markers map cleanly onto research links, and are
  the natural first integration test)
- the timeline (it declares an estimated runtime)

Its creative direction lives in its own file header and is not this repo's
concern. Do not edit the fixture to make a feature pass. Fix the feature.

---

## Known open work

- `the-shape-of-memories.fountain` needs to actually be added to the repo;
  nothing here should invent screenplay content standing in for it.
- Stack confirmed and documented above; keep this section current as the
  migration phases land instead of letting it drift back out of date.
- Derive the remaining screens from the Pandemonium Figma.
- Wire the `[[Rn]]` reference convention in the fixture to the research-link model.

The current feature queue, its architecture, and the reasoning behind each
decision live in `docs/FEATURE_ARCHITECTURE.md`. Build order and status:

1. Dark mode. **Done.**
2. Blank boards excluded from coverage, then the timesheet to timeline refactor
   (timeline is now an ordinary panel at the foot of the layout). **Done.**
3. Per-project layout persistence, then Blender corner-drag split and merge.
   **Done.**
4. Editor: Shift+Tab reverts an element transform (casing and markup both), and
   manual bold/italic restricted to elements whose parse cannot be broken by it.
   **Done.**
5. Storyboards: several boards per section with explicit ordering, blank boards
   created from a section, and image drop onto a slide during playback.
   **Done.**
6. Cloud: workspace and last-synced in the project list, the three-way merge
   replacing the last-write-wins conflict path, and script sharing
   (collaborator grants by email with viewer/editor roles, plus a revocable
   read-only link that opens the final draft and boards via `?share=TOKEN`).
   **Done.** The merge engine is `src/data/merge.js` (pure, tested in
   `merge.test.js`); a 409 from the server now opens a merge instead of
   retrying over the other writer, and `ui.merge` is transient by design so a
   half-merged project can never autosave.
7. Global context menu (replaces both the absent native-menu handling and the
   floating BETA badge, see `docs/FEATURE_ARCHITECTURE.md` section 1.4), and
   the corner-drag gesture generalized to reach any ancestor boundary a drag
   actually crosses rather than only the immediate sibling (section 1.1).
   **Done.**
8. Storyboards: final and reference now share frame count and division per
   passage (`boardSlots`/`slotBoard` in `src/state/selectors.js` pair a final
   and a reference board at the same anchor and `seq` into one slot; a slot
   only one mode has filled renders a placeholder in the other), so the
   slideshow and boards panel show the same beats switching between them
   instead of two independently-sized lists. Fixed alongside: an editor image
   drop no longer silently lands in a mode the boards panel isn't showing (it
   was reading `dropToReference` while the panel filtered on its own
   `_mode`); the new board is scrolled to and flashed pink for 2 seconds.
   `coverage()` now excludes reference boards from the boarded percentage,
   matching `addBoard`'s documented intent (hard rule 3) rather than the
   comment it had drifted from. Show Script in the boards panel now defaults
   off. **Done.**
9. Home screen: the start screen gained a recent-projects row below
   Create/Open, using a new `compact closed` variant of `pd-project-card`
   (the clapper held flat, no swing, just the art and a name). Cloud accounts
   only for now, reusing the same `listProjectsRemote()` list the account
   dialog's picker already had; local projects are a single browser-resident
   slot with no history to list yet, so the row is absent rather than empty
   when signed out. **Done.**

---

## Working context

Design in Figma. Tasks in Linear. Knowledge base in Notion. Solo founder led.

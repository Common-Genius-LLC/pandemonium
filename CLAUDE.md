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
- **Storyboard link**: a script section connected to a **storyboard**. A
  storyboard is one record with two image frames, a final one (`img`) and a
  reference one (`refImg`), either of which may be empty, plus its own `note`
  (a comment on the storyboard, separate from script comments). Making one from
  either side always makes the other side, empty, so the Final and Reference
  views list the same beats and the slideshow shows the same script in both;
  only the image differs. Viewable as a board, or as a slideshow with the image
  on top and the linked script portion in the bottom fifth of the frame.
  Several storyboards may attach to one section; their order within that
  section is the storyboard's `seq` field, since they all resolve to the same
  script position and nothing else would order them. A storyboard may also be
  **blank** (no image in either frame), created from a section before any
  frame exists. A storyboard with no FINAL image (blank, or holding only a
  reference frame) is a real link but is **not** counted as boarded by the
  timeline (see hard rule 3): the section is claimed, not drawn. A reference
  frame is inspiration and never counts toward boarded coverage.
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
   off. **Done.** Superseded by item 13: `boardSlots` and `slotBoard` are gone,
   because one storyboard record now holds both frames.
9. Home screen: the start screen gained a recent-projects row below
   Create/Open, using a new `compact closed` variant of `pd-project-card`
   (the clapper held flat, no swing, just the art and a name). Cloud accounts
   only for now, reusing the same `listProjectsRemote()` list the account
   dialog's picker already had; local projects are a single browser-resident
   slot with no history to list yet, so the row is absent rather than empty
   when signed out. **Done.**
10. New-project default layout changed to storyboards top-left, script editor
    top-right, timeline as a minimum-height strip across the foot
    (`defaultLayout()` in `src/data/layout-tree.js`); research is no longer
    shown by default. A brand-new project now seeds two drafts, "First Draft"
    and "Final Draft" (`store.loadProject`), with anything added after that
    landing between them in the tab bar (`insertDraft` in
    `src/data/project-model.js`) and numbered "Draft 2".."Draft N" (max(1,
    existing) + 1, since "First Draft" occupies slot 1). Draft tabs are
    freely drag-reorderable (`reorderScript`, wired in `draft-chip.js`); the
    final draft's tab never moves. A blank script's placeholder now reads
    "Start with a summary of the script" and is styled exactly like a
    Fountain synopsis line (`.cm-placeholder` in `cm-theme.js`), matching
    what the first keystroke actually becomes (`cm-summary-default.js`). The
    per-line hover rail (`cm-sections.js`) now shows on every draft, not only
    the final one; only its link and comment pills stay final-only, so any
    draft can still change a line's screenplay element from the hover pill.
    The slideshow no longer segments boardless stretches of script into one
    slide per scene: consecutive scenes with no board fold into a single
    continuous slide (`#buildSlides` in `slideshow.js`), and the top-left
    scene label that segmentation drove is removed (a board's own caption,
    if it has one, still shows there). **Done.**
11. Bug fixes from a review pass: pasting an image now always creates a
    reference board (`ref: true`, both the editor's own paste handler and
    `pandemonium-app`'s document-level fallback), matching the intent that a
    paste is inspiration for a beat, not a deliberate final frame; moving a
    board between Final and Reference already had no code-level restriction
    on link state, the real bug was that the boards panel filters by mode, so
    a moved board just vanished from the tab you were on, fixed by having the
    move set `highlightBoard` so the panel follows it the same way a new
    board does. The board card's Final/Reference marker pill now matches
    Edit's resting style (plain pill) and only turns pink with white text on
    hover, instead of staying permanently pink whenever the board is a
    reference. The timeline's reference hatch (`timeline.js`) was made
    seamless across adjacent bars (painted once on the row instead of per
    element); item 12 later replaced the hatch with a solid yellow fill.
    Unlink moved out to the board card's outer hover menu next to
    Edit (it is the frequent action); Delete moved into the Edit overlay for
    a linked board, but stays outside for an already-unlinked one, which has
    no link to unlink. Each linked board now has a "Preview from here" pill
    that opens the slideshow at that board's slide (`slideshow.js`'s `open()`
    takes an optional `boardId`). "Start Show" is relabeled "Preview"
    throughout. Anchors (`src/fountain/resolve.js`) now snap to whole-word
    boundaries on capture and on every edit-triggered re-derive, so a link
    reads as word-to-word and keeps that shape as the words around it change,
    layered onto the existing quote-search-plus-remap scheme rather than
    replacing it. **Done.**

12. Feature batch. **Guardrails**: `describeSlideshowGap` in
    `src/state/selectors.js` names what is missing (no script, no frames, or
    frames not linked) before Preview and Record Pacing open a show, and
    Script PDF export refuses an empty draft. **Focused writing**: a Focus
    button on the script panel sets the transient `ui.focusedLeaf`, and
    `panel-layout.js` renders just that leaf without touching the saved split
    tree. **Minimap** (`cm-minimap.js`, `@replit/codemirror-minimap`) on the
    script editor, with a 4px gutter bar beside every line a storyboard link
    lands on. **Storyboard link colors**: green for a final board, yellow for
    a reference board, in the editor highlight (`hb` / `hbr` in `cm-theme.js`),
    the timeline bars (the reference hatch is gone, replaced by solid
    `--act`), the minimap gutter (a canvas, so token values are read off the
    DOM and passed in), and a bar beside linked lines in the boards panel's
    script view (`boardLinkKinds` and `gutterRecord` in `selectors.js`,
    tested). **Timeline drop**: dropping a file on a bar of the Storyboarded
    row links a new board to that element, with the target outlined and named
    while dragging (the browser gives no image bytes until the drop, so there
    is no live thumbnail). **Popover**: the linked-text board card shows
    Unlink instead of Boards (the image itself opens the boards panel).
    **Pacing**: bars with a measured duration carry a tick, the tooltip says
    measured vs estimated, and a board's Edit overlay can clear its pacing.
    **Slideshow editing**: script lines are editable in place (Enter commits,
    Escape reverts, `#commitLineEdit` splices the line back into the
    document and re-derives that board's own anchor). Lessons kept in the
    code: a document-level keydown handler must not eat keys while a line is
    focused (`composedPath`, not `target`, since the line is in a shadow
    root), and a `contenteditable` inside a Lit template must be remounted
    (`keyed`) after an edit because the browser can disturb Lit's marker
    nodes. **Element colors**: transition and lyric read a step muted, like
    paren, in the editor, the boards script view and the slideshow.
    **Visual pass**: panels and the split guide use the 20px pill radius,
    `pd-button` is pill-rounded everywhere (with a new `icon` variant),
    storyboard frames use 20 / 1.618 = 12.36px, the script editor is a
    centered page on a grey desk with a shadow (its hover band and rail are
    anchored to the page, not the scroller), the boards panel toolbar is
    icon buttons plus Preview at the top right with the Final/Reference
    switch floating at the bottom center, and the drop-target setting moved
    to File > Storyboard settings. The clapperboard now follows the dark
    theme: its literals became tokens (the stripe colors already matched
    `--danger`, `--link`, `--act-hi`, `--ok`). **Not done**: a new design
    language, and usernames with add-by-username in the clapperboard (needs a
    `users.username` column, a lookup endpoint, and a decision on merging the
    free-text Contributors list with account-backed shares). **Done** for
    everything else.

13. Storyboard data model. Final and reference frames used to be two separate
    boards matched only by sharing an anchor and a `seq`, which let the two
    modes drift apart: a board made in one mode had no counterpart in the other,
    and the slideshow fell back to a whole-scene excerpt for the missing side
    (so Reference showed "all the rest of the script till the next section").
    A board in `project.boards` is now a storyboard: `{anchor, seq, img,
    refImg, caption, note, dur}`, with no `ref` flag. `img` is the final frame
    and `refImg` the reference frame (helpers `FRAME_KEY`, `frameImg`,
    `otherMode` in `project-model.js`). Both modes list every storyboard
    (`linkedBoards` in `selectors.js`), an empty frame is a click-or-drop card,
    and `#buildSlides` in `slideshow.js` builds one slide per storyboard from
    its own linked lines, so both modes show identical script. New reducers:
    `placeFrame` (fills the empty frame of a storyboard already on the passage
    instead of starting a second one), `swapBoardFrames` (the card's marker:
    Move to, Bring from, or Swap with the other frame), `setBoardNote`, and
    `replaceBoardImage` now takes a mode. **Blank storyboard** is offered in the
    "link to" menu (both the row rail and the selection toolbar) and as an icon
    in the boards panel toolbar; a blank frame shows the note as the shot
    description, and the slideshow does too. **Migration**: `migrateBoards`
    folds every legacy final/reference pair into one storyboard, keeps a lone
    reference board as a storyboard with an empty final frame, never pairs
    unlinked boards, loses no image, and is idempotent (returns the same object
    when already migrated). It runs in `store.loadProject` and on all three
    sides of `beginMerge`, so old files and an out-of-date device both still
    work. Sync: `refImg` travels as `refImgAssetId` beside `imgAssetId`
    (`remote-api-adapter.js`). The server's read-only share projection still
    reads `img` (the final frame), so a shared link shows final frames only.
    Coverage: a storyboard is boarded only when its final frame has an image.
    **Done.**

14. Typing bug fixed: a paragraph starting "She ", "The ", "A ", "He " (or with a
    digit) lost its first letter and was rewritten as a scene heading or a
    transition (`> HE FLOORBOARDS...`). Enter on an empty line, the ordinary
    paragraph break in Fountain, opens the element menu, and the next keystroke
    was read as a menu shortcut whenever it matched a row's letter,
    case-insensitively. Only a plain lowercase letter is a shortcut now
    (`shortcutForKey` in `element-menu.js`, tested); capitals and digits dismiss
    the menu and type. The rows stay reachable by arrows, Enter, click, or
    lowercase. **Done.**

15. Research panel, first pass. **One record, not three kinds.** A note and a
    link were never two things: the stored record has always been
    `{title, url, body, attachment}`, and the `+ Note` / `+ Link` buttons opened
    the same dialog with a different preset, after which a "note" could hold a
    URL and a "link" could hold a body with only the card's background colour
    noticing. `kind` is now derived from what a source holds
    (`researchKind` in `src/data/research-doc.js`, re-derived by
    `updateResearch` on every edit) instead of being asked for, the Kind select
    is gone from the dialog, and the URL is a field on every source in the
    reader. Old files need no migration: the stored `kind` is never read back,
    only recomputed. **Media works.** A dropped file made a record whose card
    was blank and whose reader said "Nothing here yet", and `files.js` pointed
    at a `research/attachment-viewer.js` that did not exist; it exists now and
    renders image, video, audio and PDF inline (blob URL, since Chrome will not
    navigate to or frame a `data:` PDF) with Open and Download for anything
    else. Upload is a toolbar button, not just an unadvertised drop target. A
    text-shaped file (`isTextShaped`, previously dead code) is read into the
    notes instead, so its passages are linkable. **Colour.** Six muted fills
    (`--note-*` in `tokens.css`, both themes), set from the card's overflow menu
    or the reader's, using a new `accent` swatch on `pd-menu` items. **Finding
    things.** Search across title, notes, URL and file name, plus an "unlinked
    only" filter, both pure in `filterResearch` and tested. **The other end of
    the link is visible.** The reader lists the script passages a source backs,
    each row jumping to the passage, unlinking, or reattaching a lost one; the
    card's link count is a button that jumps rather than a statistic.
    **Bug: the research link path was unreachable on the default layout.**
    `link to > Research` armed `ui.linking` without revealing a research pane
    (the storyboard path has always called `revealContent`), so on the default
    layout it put up a bar telling the user to click a card that was not on
    screen; `openPair` had the same hole. Both reveal now. **Bug: nothing could
    be created mid-link.** Anything created while the script waits for a source
    (note, file, link, dialog) now answers that wait and links itself. Also:
    URL and image drops and pastes onto the panel, `addResearch` storing an
    empty title rather than the literal word "Untitled", and the empty pane
    carrying its own invitation. **Not done**: Read and Write are still two
    modes (only Read can resolve a selection to an anchor; Phase 3's CodeMirror
    surface unifies them, as it did for the script), Write does not show the
    media beside the notes, and a link is stored as typed with no title or
    favicon fetched. Superseded in part by item 16, which removes the mode.

16. Research panel, second pass: nothing to be told before using it.
    **The edit mode is gone.** Read / Write meant the same surface did
    different things depending on a toggle: in one you could link a passage but
    not fix a typo, in the other the reverse. Notes are edited where they are
    read, a paragraph at a time, reusing the slideshow's in-place line editing
    (`keyed()` to remount a contenteditable, `composedPath` for document-level
    keys). Enter splits at the caret, Backspace at the start merges upward,
    Escape reverts through `execCommand`, clicking under the notes puts the
    caret at their end. The splicing is pure and tested (`parasToBody`,
    `setPara`, `splitPara`, `mergePara`); anchors need no re-derivation because
    a research anchor is a quoted string searched across paragraphs. A commit
    carries the edit generation it was rendered in, so a blur fired by a
    browser that removed the element it just split cannot write the pre-split
    text back over the first half. `ui.readerEdit` is retired for
    `ui.openDocFocus` ("start with the caret here"). A link highlight stays an
    object: the cursor turns from caret to pointer over it, and mousedown is
    suppressed so clicking opens the pair rather than placing a caret.
    **One way to create.** The `+ New source` tile heads the grid, card-shaped
    because it makes a card, naming the two faster routes (drop a file, paste a
    link) where they are used. The creation modal is deleted: the script's
    `link to > Research` no longer branches on whether any source exists, it
    reveals the panel and arms the pick, and anything created while armed links
    itself (`#consumePendingLink`). **Open like a card.** A source opens as the
    card it came from, same rounding and same colour, holding its material,
    then its labels, then its notes, then the passages it backs; closing is a
    `×` at the far right (and Escape), not a back.
    **Link previews** (`src/data/link-preview.js`, tested): YouTube, Vimeo,
    direct image/video/audio/PDF and ordinary pages, recognised from the URL
    alone. Nothing is fetched and no unfurl service is asked, because handing a
    third party the reading list for an unreleased screenplay is not worth a
    thumbnail; previews come from the link's own origin. A video loads its
    player only on click, through `youtube-nocookie.com`. The cost is no
    fetched titles, which would need a server-side unfurl in `server/` with its
    own SSRF guards. **Labels** group sources into topics: free text, deduped
    case-insensitively, the whole list derived from what is in use
    (`allLabels`), so there is no label manager and no orphans. Chips on the
    card and in the reader, a topic row above the grid that filters (several
    topics widen, the search box narrows). Labels stay neutral on purpose: a
    source already has a colour, and two colour systems would be one more thing
    to keep straight. **Also:** newest first (insertion order buried every new
    source below the fold), right-click a card for its menu with the global
    items, the unlinked filter says "Unlinked" rather than wearing a
    broken-chain glyph, `revealContent('script')` on the research-to-script
    direction (the mirror of item 15's fix), the empty "backs" block teaches
    linking from both ends, and hidden hover controls get `pointer-events:none`
    so they stop eating clicks. **Not done**: no drag to reorder the grid, no
    fetched link titles, and a source's notes still commit on blur rather than
    continuously.

17. Research panel, third pass, plus settings.
    **Bug: the link field and the label field could not be used at all.** The
    click handler that puts the caret at the end of the notes lived on the
    whole scroller and held off with a list of selectors to ignore. Clicking
    "+ Label" or "Edit link" was caught there and turned into "focus the
    notes", so neither could be reached. The handlers belong to a `.notes`
    container now and to nothing else, which fixes it by construction and
    leaves no blacklist to keep in step as sections are added.
    **The notes are a sticky note.** 17px text, no field, no border, no focus
    outline, a tall clickable surface: what it looks like is what tells you it
    is yours to write on.
    **Colour is a swatch row.** `pd-menu` takes `{swatches: [...]}` and renders
    one row of round buttons at the top of the menu instead of six labelled
    rows, because colour is the one choice where the word is worth less than
    the thing. Each colour is now two tokens, the muted card fill (`--note-*`)
    and a saturated, slightly darker dot (`--note-*-dot`), since one value
    cannot serve both a large quiet surface and an 18px circle. "Open" left the
    card's menu: clicking the card is what opens it.
    **Settings.** File > Settings, one window (`pd-settings`), no Save because
    every control acts as it is touched (`doneOnly` on `pd-dialog`: a single Done, no Cancel promising a revert). It holds
    the theme, which gains "Match system" (the title-bar toggle could only flip
    light and dark, so the preference that follows the desktop had no way
    back), and the storyboard drop target, moved out of its File submenu. The
    title-bar theme glyph and `pd-theme-toggle` are deleted, and "Toggle theme"
    is gone from the right-click menu, which is about what was clicked again;
    `withGlobalItems` no longer emits a trailing divider when nothing follows
    it. **Script panel** is one white surface, chrome strip and desk alike,
    matching every other panel (the desk was grey and the strip a second,
    slightly different grey). The page takes `--field` rather than `--bg`, or
    on the dark theme it would be the same colour as the desk it lies on and
    stop reading as a page; inactive tabs keep `--chrome-panel` so the cut-out
    still works.

18. Rich links for every site, and Clarity.
    **Backend** `GET /v1/link-preview?url=` (`server/src/link-preview/`,
    `server/src/routes/link-preview.ts`). Public by decision (signed-out users
    are most users) and fenced accordingly: an SSRF guard on EVERY redirect hop
    (`ssrf.ts`: http(s) only, no credentials, web ports only, and every address
    a name resolves to must be public, including v4 hidden in
    `::ffff:`/NAT64/6to4 forms, because Oracle Cloud's metadata service sits at
    169.254.169.254), manual redirects capped at 5, an 8 s budget, a 1 MB read
    cap, a global cap of 8 upstream fetches with a bounded queue, a per-IP
    fixed-window limit (60/min, `rate-limit.ts`), an in-memory LRU cache (24 h,
    failures 10 min) with in-flight de-duplication, and a response that is only
    ever a metadata summary. Parsing is Bun's native HTMLRewriter plus the
    `entities` package, because HTMLRewriter hands back `&amp;` undecoded.
    Encoding is sniffed WHATWG-style (BOM, header, `<meta>` prescan). The
    fallback per field is fixed and reported in `sources`: title og > twitter >
    `<title>` > URL; description og > twitter > meta > first non-empty `<p>`;
    image og > twitter > `link[rel=image_src]`, never an arbitrary `<img>`.
    `domain` is the REQUESTED URL's host, not the post-redirect one, so a
    shortener cannot dress one site up as another. **Two user agents**: a
    desktop Chrome first, as specified, then `PandemoniumBot/1.0` only when
    the first answer is thin. The live check showed why: Spotify gives Chrome
    a metadata-free JavaScript shell and Amazon gives it a 202 challenge, and
    both give a self-identified bot the full card. The bot is our own name,
    not Facebook's or Slack's, and must not start with "Mozilla/5.0": Amazon
    challenges anything that looks like a browser. Only 200/203 count as a
    page. **Tests**: 70 offline cases in `server/test/link-preview.test.ts`
    (every fallback tier, entities, encodings, the SSRF table, redirects,
    blocks, timeouts, caps, caching, the two-agent strategy, the route), and
    `bun run validate:link-preview [--api <base>]` for the seven live sites
    (ogp.me, example.com, YouTube, Spotify, Amazon, http GitHub, ja.wikipedia),
    all passing at the time of writing. Deploy needs `TRUST_PROXY=true` behind
    nginx or every user shares one rate bucket; `docs/DEPLOYMENT.md` B8 has the
    network-level backstop for DNS rebinding, which code cannot close.
    **Frontend** `pd-link-preview` (`src/components/ui/link-preview.js`):
    skeleton, then a social card laid out by container query (image on top at
    1.91:1 when narrow, beside when wide), `object-fit:cover`, one-line
    domain and title, two-line description, `referrerpolicy="no-referrer"`,
    video still plays in place on click; any failure or empty answer degrades
    to a plain link. A research source keeps `storablePreview` of it (no
    timestamps, so two devices never conflict), which names untitled links,
    fills the grid card and is searchable, and is dropped when the URL changes.
    **Clarity** (`src/utils/clarity.js`, id in `.env.production` only). Masks
    by `data-clarity-mask` on every surface holding the writer's words. Checked
    against the live recorder (0.8.70): a node inherits its parent's privacy
    and a shadow root's parent is its host, so a container mask covers its
    whole shadow tree; dashboard selector masks cannot reach into shadow roots,
    so the attributes in code are the only targeted control. Set Strict in the
    dashboard as the backstop. **Not done**: a privacy notice and consent
    banner (GA4 already needed the notice; Clarity's terms require one, and
    `Clarity.consentV2` exists for EEA/UK/CH consent).

---

## Working context

Design in Figma. Tasks in Linear. Knowledge base in Notion. Solo founder led.

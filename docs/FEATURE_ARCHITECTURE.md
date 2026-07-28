# Feature architecture

The plan for the five feature domains queued after the Lit migration reached
feature parity. Written to be implemented in the build order at the foot of this
file. Companion to `docs/BACKEND_ARCHITECTURE.md`, which owns everything on the
server side.

Every rule in `CLAUDE.md` applies here, and two of them shape the designs below
rather than merely constraining them:

- **Hard rule 2 (Fountain fidelity)** is why manual emphasis is a whitelist and
  why the element revert re-applies markup instead of only re-casing text.
- **Hard rule 3 (honest timeline math)** is why blank storyboards do not count
  as boarded, and why the timeline draws tick marks at a step it can actually
  resolve instead of one line per second at any zoom.

---

## Decisions already settled

Two questions were open when this plan was written. Both are now answered, and
the answers are load-bearing for the code below.

1. **A blank storyboard does not count toward boarded coverage.** A board with
   no image is a claim that a beat needs boarding, not evidence that it has
   been. Counting it would inflate the one number the product exists to report.
   The section still shows its storyboard highlight in the script (the link is
   real), and the timeline tooltip reports pending boards separately, so the
   work is visible without being counted as done.
2. **Panel layout persists per project, not per user.** A layout is part of how
   a particular project is being worked on (a research-heavy pass wants a wide
   research pane; a boarding pass does not), so it travels with the project
   file and syncs with the project to the account. This moves `layout` out of
   the transient `ui` branch and into the persisted `project` branch, which is
   an additive schema change: files written before it simply have no `layout`
   key and fall back to `defaultLayout()`.

---

## 1. UI and layout

### 1.1 Blender-style corner split and merge

The binary split tree in `src/data/layout-tree.js` is already the right model
and already has `splitLeaf`, `closeLeaf`, `setRatio` and `leafCount`, all pure.
`src/app-root/panel-layout.js` already renders it recursively with draggable
dividers. The only thing missing is the gesture: splitting is done today from
hover buttons in a pane's corner, and merging is an X that closes a pane.

Corner drag maps onto the existing tree with no new tree concept:

- **Drag a corner inward**: split. The drag axis picks `dir` (a mostly
  horizontal drag gives a `row` split, a mostly vertical one gives `col`), the
  release point gives the ratio, and the corner grabbed decides which side the
  new pane lands on.
- **Drag a corner outward, past the divider**: merge. The pane you dragged from
  swallows the subtree on the other side of its own divider. In a binary tree
  that is exactly "replace the parent split with this leaf".

Restricting merge to the sibling subtree loses nothing. In the tree, the region
on the far side of a given divider *is* the sibling subtree, and that divider is
the only one any corner of the pane touches. There is no adjacent region a
corner drag can reach that this rule excludes.

New pure helpers in `layout-tree.js`: `parentOf`, `subtreeContains`,
`siblingSubtree`, `splitLeafAt(node, id, dir, ratio, before)` and
`absorbSibling(node, keepId)`.

The gesture itself lives in `panel-layout.js` as four grip elements per leaf and
one pointer handler that classifies the drag after an 18px threshold, previews
the result with an absolutely positioned ghost element (so nothing in the tree
re-renders per pointer move, matching how divider drags already work), and
commits one `setLayout` call on release.

### 1.2 Layout persistence (per project)

`layout` moves from `ui` to `project`:

- `src/data/schema.js`: `emptyProject()` gains `layout: null`.
- `src/state/store.js`: `loadProject` seeds `project.layout` from the raw
  project or `defaultLayout()`; `defaultUI()` no longer carries a layout;
  `viewInfo` and `viewPatchAffectsView` read `project.layout`.
- A single `store.setLayout(next)` action routes through `#applyProject`, so a
  layout change marks the project dirty and autosaves like any other edit.
- Every reader (`panel-layout.js`, `panel-picker.js`) switches from
  `store.ui.layout` to `store.project.layout`.

Because layout now rides in the project document, the server's
`validateProject` must accept the key. See `docs/BACKEND_ARCHITECTURE.md`.

### 1.3 Dark mode

Design tokens are inherited CSS custom properties declared once in
`src/styles/tokens.css`, and shadow DOM inherits custom properties, so a second
token block under `:root[data-theme="dark"]` re-themes every shadow root in the
app with no component change. That makes the theme itself nearly free. The work
is in three other places.

**The theme module.** `src/state/theme.js`, framework-agnostic and
`EventTarget`-based, matching how `src/data/session.js` is built. Holds a
preference of `light`, `dark` or `system`, persists it to `localStorage` under
its own key (it is a per-user setting and must not enter the project file, which
is now also true of layout but for the opposite reason), and writes `data-theme`
onto `document.documentElement`.

**The palette.** Built for a dark room rather than by inverting the light one.
The page never goes to pure black (it flares against the script surface), the
script surface stays a shade lighter than the page so it still reads as paper,
and the action yellow is desaturated because at full chroma on a dark field it
glares.

**Hardcoded colours that defeat the theme.** These must be tokenised in the same
change or the dark theme is half-applied:

| File | Literal | Token |
| --- | --- | --- |
| `src/app-root/timeline.js` | `#cfcfcf` segment hover | `--ph-hi` (new) |
| `src/app-root/timeline.js` | `#7fae53` boarded label | `--board-ink` (new) |
| `src/components/auth/account-dialog.js` | `#fff` input fill | `--field` (new) |
| `src/app-root/start-screen.js` | white to `#d8d8d8` gradient | `--scrim-a` / `--scrim-b` (new) |

`src/components/slideshow/slideshow.js` deliberately uses literals and is left
alone. Its own file comment explains why: playback is always a lights-down
surface regardless of the app theme.

**The print catch.** PDF export is `window.print()` against `#printRoot`
(`src/components/print/print.js`). Under dark tokens the print root inherits
dark values and exports a black page. `global.css` therefore forces the light
token values inside `@media print`, for both the default and the dark root.

---

## 2. Script editor

### 2.1 Live, non-destructive formatting (Shift+Tab restores casing and format)

Casing is destructive today. `applyElement` in `src/fountain/element-ops.js`
upper-cases for `scene`, `character` and `transition`, and the `autoUppercase`
transaction filter in `src/components/editor/cm-autoformat.js` keeps re-applying
it as you type. Shift+Tab currently just runs the Tab cycle backwards, so the
writer's own casing is unrecoverable once an element is applied.

The fix is a **case journal**: a CodeMirror `StateField`
(`src/components/editor/cm-case-journal.js`) that records the line's
pre-transform raw text and element whenever `setLine()` applies an element,
mapping its position through document changes exactly as `activeElementField`
maps its pin, and dropping the entry when the caret leaves the line.

Two details make this genuinely non-destructive:

1. **Text typed after the transform survives.** The journal stores the original
   text, not the whole line, and `restoreCasing(current, original)` re-applies
   the original casing only where the two still agree case-insensitively.
2. **The restore is not immediately undone.** `autoUppercase` would re-upper the
   line on the next keystroke, so restore also sets a `caseExempt` marker,
   cleared when the caret leaves the line, which the filter honours.

Fountain fidelity holds through this. `SCENE_RE` is case-insensitive, so a scene
heading restored to `int. kitchen - day` still parses as a scene heading. A
restored character cue stops parsing as a cue, which is correct: the writer
asked for the original format back, and the file now says what the screen shows.

New in `element-ops.js`: exported `stripForcing`, plus `restoreCasing` and
`applyElementPreservingCase`. New in `cm-autoformat.js`: `revertElementAtCaret`,
wired as `shift: (v) => revertElementAtCaret(v) || cycle(v, getParsed, -1)`, so
Shift+Tab keeps its cycle meaning wherever there is nothing to revert.

### 2.2 Manual bold and italic, restricted by element

Fountain inline emphasis is already supported end to end and needs **no parser
change**. `inlineRuns` in `src/fountain/parse.js` handles `***`, `**`, `*`, `_`
and escapes; `blockHTML` renders them; and `cm-fountain-plugin.js` already
decorates the runs live and dims the delimiters. A manual bold command is
therefore purely a source-text mutation plus a permission check.

The permission check is the design decision. Rigid elements are rigid because
their parse depends on their exact text: a character cue is recognised by being
all caps, a transition by its `TO:` suffix, a scene heading by its prefix.
Injecting delimiters into those can change what the line *is*, not just how it
looks. So `canFormat()` is a whitelist (`action`, `dialogue`, `centered`,
`lyric`, `synopsis`), never a blacklist.

New pure module `src/fountain/inline-format.js` holds `MARKERS`, `FORMATTABLE`,
`canFormat` and `toggleMarker(text, from, to, marker)`, all DOM-free so they can
be tested against a real parse. `src/components/editor/cm-emphasis.js` wraps
them as a CodeMirror command bound to `Mod-b`, `Mod-i` and `Mod-u`.

A multi-line selection applies line by line and **skips** lines whose element
does not accept emphasis rather than refusing the whole command. For a selection
spanning a cue and its speech, that means the speech gets its emphasis and the
cue is left intact, which is what the writer meant.

---

## 3. Storyboards

### 3.1 Several boards on one section

This is already representable: `project.boards` is a flat array and each board
carries an independent `anchor.parts`, so two boards can resolve into the same
passage. What blocks it in practice is ordering. `boards-panel.js` and
`slideshow.js` both sort by `firstBi` alone, and two boards on one anchor have
an identical `firstBi`, so their order is whatever the sort happens to do. A
storyboard sequence with undefined order is not a storyboard sequence.

Boards gain a `seq` field, assigned per anchor. Sorting everywhere becomes
`(a.firstBi - b.firstBi) || ((a.bd.seq || 0) - (b.bd.seq || 0))`. Files written
before this have no `seq`; readers treat a missing value as `0` and the sort
stays stable, so nothing already saved is invalidated.

New reducers in `src/data/project-model.js`: `addBlankBoard`, `reorderBoard`,
and a `nextSeq`/`anchorKey` pair. `reattachBoard` takes a fresh `seq` at its new
anchor so a moved board does not inherit a position in a run it just left.

### 3.2 Blank boards, and dropping an image during playback

A blank board is just `img: null`. Both `board-card.js` and the slideshow's
`.noimg` state already render it correctly, so no new rendering state exists.
Creating one from a script section reuses the same `{q, b, s}` part array that
`addLink` already receives from `selection-capture.js`.

**Blank boards do not count as boarded.** `coverage()` in
`src/state/selectors.js` skips boards with no image when accumulating `bset` and
`nb`, and counts them into a separate `nbPending` so the timeline tooltip can
say "2 boards, 1 awaiting an image". The storyboard highlight in the script is
still painted, because the link itself is real.

For **drag and drop onto a specific slide**, the blocker is that `_slides` is a
snapshot built once by `open()` and carries no board identity. Slides gain a
`boardId` (null for the text-only slides a board-less scene produces, which
refuse the drop rather than silently creating a board behind the presenter's
back), plus a `#refreshSlides()` that rebuilds the snapshot while holding
`_ix`, so the presenter stays on the slide they just filled.

---

## 4. Timesheet to timeline

Four coordinated changes.

1. **Rename.** `src/app-root/timesheet.js` becomes `timeline.js`,
   `PandemoniumTimesheet` becomes `PandemoniumTimeline`, the element
   `pandemonium-timesheet` becomes `pandemonium-timeline`, and `timesheetStats`
   in `selectors.js` becomes `timelineStats`. One import site each.
2. **Becomes a panel.** `timeline` joins `script`, `boards` and `research` as a
   leaf content type in `layout-tree.js`, in `panel-picker.js`'s labels, and in
   `panel-layout.js`'s `#panelFor`. It adopts `panelStyles` from
   `src/styles/shared.js` so it gets the same shell, chrome and picker as the
   other three.
3. **Moves to the bottom.** Removed from the fixed app chrome in
   `pandemonium-app.js`; `defaultLayout()` puts a timeline leaf across the
   bottom. It used to be chrome above the layout, which meant it could not be
   closed, moved, or given more room when it was the thing being read.
4. **New metric layout.** Boarded on the top row, sourced on the bottom row,
   and the `est [length] of [target]` figure at the top right of the panel
   chrome.

**Tick marks.** One marker line per second is the intent, but it is only honest
while a second is wide enough to draw. A 12 minute script in a 900px strip gives
720 seconds at 1.25px each, which renders as a grey wash implying a precision
the strip does not have. The step therefore climbs through units a reader
already thinks in (1, 5, 10, 30, 60, 300 seconds) to hold a minimum 6px gap, and
the panel states which step is on screen. Hard rule 3 applies to a drawn scale
exactly as it does to a printed number.

The ticks are painted as a repeating background gradient, not as elements: at
one line per second a long script would otherwise add hundreds of nodes to be
re-rendered on every keystroke.

---

## 5. Cloud and collaboration

### 5.1 Cloud project list (workspace and last synced)

The client picker in `account-dialog.js` cannot show a workspace because the
server's list route selects `id, name, updated_at` only, and `workspace` lives
inside the `data` blob. Reaching into the blob per row needs `json_extract` on
SQLite and `->>` on Postgres, which breaks the single query layer the backend is
built around, so `workspace` is promoted to a real column written on insert and
update exactly as `name` already is.

"Last synced" is relative, not a date: a project touched four minutes ago
showing today's date does not answer the question a sync indicator is actually
asked, which is whether the last edit landed. New `fmtAgo` in
`src/utils/format.js`.

### 5.2 Script sharing

Phase A stores a whole project tree as one row, so a grant is **project-scoped**.
A UI offering per-script access would describe an isolation the storage cannot
enforce, which is a promise rather than a UI detail. Two grant kinds:

- **Collaborator grant**: another account by email, role `viewer` or `editor`,
  rows in `project_shares`. The server's `ownedRow` generalises to an
  `accessibleRow` returning an effective role, with writes gated on `editor`.
- **Read-only link**: an unguessable token rendering the final draft and its
  boards without an account. This is the genuinely script-shaped case, and it is
  minted rather than derived so it can be revoked independently of the project.

Client side this is a fourth adapter, `src/data/sharing-adapter.js`, re-exported
through `src/data/db.js` so components keep talking only to the seam.

### 5.3 Multiplayer merge

The most important fact here is that **the current conflict path destroys other
people's work**. `remote-api-adapter.js` catches the server's 409, adopts the
server timestamp and retries. Its own comment is honest that this is
last-write-wins, and for one user on two devices that is defensible. The moment
a second person can write, that retry is a data-loss bug, because the 409 body
already carries the other version and the client discards it.

Multiplayer state handling is therefore: replace that retry with a three-way
merge. The server already supplies two of the three inputs (`session.getBase()`
is the last-seen timestamp, the 409 body is `theirs`, the store holds `mine`);
what is missing is the base *content*, so `session` retains the last-synced
project snapshot alongside its timestamp.

The merge splits by data shape, which is what makes it tractable without a CRDT:

- **Scripts** are line-oriented text, so a line-level diff3 gives real git
  semantics: non-overlapping hunks merge silently, overlapping ones become
  conflicts a human resolves.
- **Boards, research, links and comments** are id-keyed records, so they merge
  as sets. Additions from both sides union, a delete on one side with no edit on
  the other applies, and the same field edited differently on both sides is a
  conflict.
- **Anchors need no merge at all.** `resolve.js` re-searches quoted text rather
  than trusting offsets, so a link survives a merged edit for the same reason it
  survives a local one. This is the Phase 1 anchoring decision paying off, and
  it is why merging here is far less dangerous than it would be in an
  offset-anchored editor.

State lives in a transient `ui.merge` branch. It must be transient: an
unresolved merge is a live negotiation, and persisting it would let a
half-merged project autosave itself into the account.

**Hard rule 4 is enforced at commit, not during merge.** Two people can each
promote a different draft to final, so the committed project is re-run through
`normalizeDraftNames` and a final-draft tiebreak. Without that, a merge quietly
produces two link-owning drafts.

Presence (who else is in the document) is a separate concern and is deliberately
not built into this path. It needs a live channel that Phase A does not have.
Its seam is a future `src/data/presence.js` beside `session.js`, backed by SSE,
landing with Phase B.

---

## Build order and status

Not arbitrary. Two dependencies are real, and both were honored.

**Everything below has landed.** The merge shipped before sharing, per the
caveat under 5.3: the old conflict path discarded the other writer's work, so
sharing could not be allowed to create a second writer first.

Implementation notes for what shipped beyond the plan text above:

- The merge engine is `src/data/merge.js`, pure and covered by
  `src/data/merge.test.js`. When the base snapshot is missing (a reload loses
  it; it is in-memory because it can be multi-megabyte) the merge degrades to
  a two-way merge: common regions still merge, genuine divergence conflicts,
  nothing is guessed.
- Project meta (name, workspace, type, target, layout, contributors) merges
  field-wise with mine winning ties, and never raises a conflict: a modal
  negotiation over a field the settings card can change back in one keystroke
  is disproportionate.
- The conflict handler is injected into the remote adapter
  (`setConflictHandler`) so the adapter never imports a component. The merged
  result is pushed with `saveMergedRemote`, which adopts the concurrency token
  the 409 reported so the reconciling write cannot 409 against the version it
  just reconciled.
- Sharing is `server/src/routes/shares.ts` plus `src/data/sharing-adapter.js`
  behind the db.js seam and `src/components/collab/share-dialog.js`. Grants
  need an existing account (no email pipeline exists to invite with). The
  read link serves a projection: final draft and boards with images inlined,
  research and contributor names stripped.
- Asset reads became authenticated-capability (any signed-in holder of the
  unguessable id) rather than owner-only, because collaborators must hydrate
  each other's images and Phase A assets carry no project linkage to check
  against. Phase B's granular tables turn this into a real access check.
- A viewer-role collaborator's autosaves are refused server-side (403); the
  client surfaces that once, with the export path as the escape hatch, instead
  of letting every keystroke fail silently into the console.

1. **Dark mode.** Touches every component, so landing it first means the new
   panels and dialogs below are written against tokens rather than retrofitted.
2. **Blank boards excluded from coverage**, then the **timeline refactor**. The
   coverage rule changes what the timeline reports, so it lands with the panel
   that reports it.
3. **Per-project layout persistence**, then **corner-drag panels**. The gesture
   writes through the persistence path, so the path exists first.
4. **Editor enhancements** and **storyboard upgrades**. Independent of the above
   and of each other.
5. **Cloud list**, then **sharing**, then **multiplayer merge**, strictly in
   that order. Merge needs a second writer to exist, and sharing needs the
   server-side access check that the workspace column change touches.

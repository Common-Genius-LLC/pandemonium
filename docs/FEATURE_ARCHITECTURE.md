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

**Superseded.** Restricting merge to the *immediate* sibling subtree turned out
to lose something real: on the default layout, `research`'s immediate sibling
is the whole `(boards, script)` row, so research could never merge with
`timeline` below it (timeline is two levels up, sibling of research's parent,
not of research itself) even though the two are visually adjacent. The gesture
now walks outward through however many ancestor boundaries the drag actually
crosses, not just the first one, and distinguishes two outward cases: if the
far side of the crossed boundary is a single pane, the drag absorbs it outright
(unchanged from before, just reachable from farther away); if the far side is
itself a multi-pane cluster, the drag targets the specific pane touching the
crossed boundary and splits *that* pane instead, carrying the dragged pane's
own content into the fresh sliver, so growing into a big neighboring cluster
reads as "claimed a piece of it" rather than "swallowed the whole thing".

Pure helpers in `layout-tree.js`: `pathTo(node, id)` (the root-to-leaf chain, so
the gesture can walk outward once instead of repeated top-down searches),
`absorbAcross(node, ancestorId, keepSide)` (collapses an arbitrary ancestor down
to one side, generalizing the old immediate-parent-only `absorbSibling`), and
`splitLeafAt(node, id, dir, ratio, before, content)` (the trailing `content`
override is what lets a split target a different pane than the one dragged).
`parentOf`, `subtreeContains`, `siblingSubtree` and `absorbSibling` were removed
once nothing else called them.

The gesture itself lives in `panel-layout.js` as four corner handles per leaf
(only the one nearest the pointer is shown, within a fixed radius, rather than
all four on any hover) and one pointer handler that classifies the drag after
an 18px threshold, previews the result with an absolutely positioned ghost
element (so nothing in the tree re-renders per pointer move, matching how
divider drags already work), and commits one `setLayout` call on release.
Right-clicking a pane reaches the same two moves, plus switching its content,
without a drag; see the global context menu system below.

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
glares. The script page has a palette of its own (`--pg-*`) and, since 9.2, its
own dark reading of it.

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

### 1.4 Global context menu, and BETA reporting off the floating badge

There was no `contextmenu` handling anywhere: the browser's native menu showed
everywhere, and beta bug reporting lived on a fixed floating badge
(`pd-beta-badge`, bottom-right). Both are replaced by one mechanism.

The existing single-instance popover `src/components/ui/menu.js` (`pd-menu`,
already mounted at app-root and opened via a bubbling `pandemonium-open-menu`
event) is reused rather than duplicated: `open()` now also accepts `{x, y,
items}` as an alternative to `{anchor, items}`, positioning at a raw viewport
point (there is no anchor element for a cursor position), and items can be
`{divider: true}` for a separator.

`src/utils/context-menu.js` exports the one place "these items belong on every
menu" is expressed: `withGlobalItems(el, items)` appends a divider and the
global section (theme toggle, and "Report a problem" when `BETA` is on,
carrying a live count from `bugReporter.errorCount`) to whatever
panel-specific items a caller already built. Every right-click handler in the
app funnels through it, so there is exactly one copy of what "global" means.

Native `contextmenu` is `composed: true`, so it already crosses shadow
boundaries the same way `pandemonium-open-menu` does. Two handlers, inner
first:

- Each pane's `.leaf` element (`panel-layout.js`) handles its own
  `contextmenu`: switch-content items (mirroring `panel-picker.js`, sharing its
  `PANEL_LABELS`), then split left/right, split top/bottom, and close if more
  than one pane exists. These three are also the removed hover buttons' only
  home now, and the accessible, non-drag path to what the corner gesture does.
  Calls `stopPropagation()` after building its menu.
- `pandemonium-app.js` has one fallback `contextmenu` listener that only ever
  fires for chrome outside any pane (the leaf handler already stopped it
  otherwise), offering just the global items.

Between the two, `preventDefault()` is called somewhere on every surface in the
app, so no separate always-on capture-phase listener is needed to suppress the
native menu.

This is the extension point for later, more specific menus (a script row, a
board card): an inner component adds its own `contextmenu` handler and calls
`stopPropagation()` before it reaches the leaf's, same pattern, innermost
wins first refusal. Not built out yet.

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

### 4.1 Written versus planned (the coverage strip proper)

The strip reported boarded and sourced coverage but had no notion of how much
of the script existed at all, and `scenesOf` awarded every scene a minimum of
2 seconds, including scenes that were nothing but a heading. That inflated the
running-time estimate by exactly the part of the script that had not been
written, which is a hard rule 3 violation: the estimate was reporting planned
scenes as though they had been timed.

A scene is **scripted** when it has at least one content block under it
(`CONTENT_TYPES`); a heading carrying only a synopsis (`=`) is an outline note,
not script. Unscripted scenes now carry 0 seconds, so the header estimate is
the running time of what is actually written, and `scriptProgress(scenes)` in
`selectors.js` reports the split separately.

`scriptProgress` counts **scenes**, not seconds, and that is load-bearing
rather than incidental: an unwritten scene contributes 0 seconds, so a
seconds-weighted percentage computes written over written and reports every
draft as 100% written. Counted by scene, a script with two of three scenes
written reports 67%.

In the strip, an unwritten scene gets a fixed narrow slot rather than a
proportional width, because there is no estimated duration for it to be
proportional to. Drawing it at a guessed length would draw the unwritten part
of the script at a length the script does not have.

`sectionsOf(parsed)` in `fountain/blocks.js` reads Fountain sections (`#`,
`##`) as the outline structure a writer already thinks in (ACT ONE, SEQUENCE 3)
and keeps their depth, so the strip can divide by top-level act without losing
the finer headings. Tests: `src/fountain/script-progress.test.js`.

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

## 6. Sound

Sound is the fourth thing the app ties together, after the script, the
storyboard and the references. The question it had to answer first was what
sound is laid out AGAINST.

**The ruler is the storyboard, not a stopwatch.** A film's sound is cut to
picture. Here the picture is the storyboard sequence, so the scale across the
sound panel is the storyboards in order, each as wide as it is long
(`boardSpans` in `state/selectors.js`), and a clip is stored as "this far into
that storyboard" (`clip.boardId` + `clip.offset`) rather than as an absolute
number of seconds. The reason is not elegance. A storyboard's duration changes:
recording the pacing of a show replaces a word-count estimate with a measured
figure, and reordering a beat moves everything after it. With absolute starts,
every clip downstream of such a change would be in the wrong place and the
writer would have to drag them all back. Anchored, the sound moves with the beat
it was cut against, which is the whole of what "in sync with the storyboard" can
honestly mean before there is a renderer.

A clip before the first storyboard, in a project with none, or whose storyboard
has since been deleted, is absolute (`boardId: null`, the offset counted from
the top). `clipStart` falls back to the offset rather than dropping the clip, so
deleting a board never loses audio.

**Where a board's length comes from, and saying which.** `boardSeconds` returns
`{secs, paced}`: a measured `board.dur` when the show has been played at the
intended pace, otherwise the words of the passage it is linked to read at the
same pace the timeline's bars use (`elementSeconds`, which moved into
`selectors.js` so the two cannot drift). The panel's strip says Measured or
Estimated, and each span carries it, because a scale made of guesses must not
look like a scale made of measurements. Hard rule 3 applies to a drawn scale
exactly as it does to a printed number.

**Three flat collections, not one tree.** `project.sounds` are the files,
`project.tracks` the lanes, `project.clips` what is heard. Flat and id-keyed
because `data/merge.js` merges id-keyed collections as sets: three collections
at the top of the project merge for free, where one nested `audio` object would
be one field two devices fight over. It also means cutting a clip in two costs
nothing: both halves point at the same sound and carry their own window into it
(`in` and `dur`).

**The file lives once, and does not outlive its clips.** A sound travels as a
data URL in the project and is lifted into the asset store on sync, exactly like
a storyboard frame (`remote-api-adapter.js`, `sounds[].data` to
`sounds[].assetId`; `downscaleDataURL` only touches `data:image/`, so audio
passes through untouched). Audio is the largest thing a project carries, so
deleting the last clip cut from a sound deletes the sound (`prune` in
`audio-model.js`): a file left behind by the clip that referenced it would be
megabytes of silence in every save and every sync from then on. Imports are
capped at 25MB with a message, because past that the project itself stops being
saveable.

**Playback is Web Audio, and the schedule is pure.** `playPlan` turns the
arrangement into plain numbers (when, offset, duration, gain) with no knowledge
of storyboards, and `components/sound/audio-engine.js` schedules each one as an
`AudioBufferSourceNode` against the audio clock. That is the only API that can
say "start this file at this moment, from this point, for this long" in one
call; an `<audio>` element can only seek and hope, which is audible the moment
two tracks have to line up. A file's length is measured with an `<audio>`
element at import (`measureDuration`), because an AudioContext created before
the first gesture is suspended and some browsers refuse one outright; a file the
browser will not decode reports 0 and the clip says its length is unknown.

**The drag is not written until the pointer is released.** A clip dragged across
four seconds would otherwise be forty project updates, each re-rendering every
other panel and queueing an autosave, so the panel holds a preview
(`this._drag`) and commits once on pointerup. Snapping is pure (`snapTime`)
against the storyboard boundaries, the playhead and the other clips' edges, with
the tolerance converted from pixels so it feels the same at every zoom.

**In the show.** Arriving at a beat plays the arrangement from that beat
(`#syncSound` in `slideshow.js`). The show is advanced by hand, so a beat held
longer than its pacing simply keeps playing and one cut short jumps the sound
forward; script between two boards (an unlinked slide) does not seek at all, so
the sound runs on under it rather than restarting. Sound is off while pacing is
being recorded: it would be playing against the very timings being measured.

**"link to > Sound"** on a script passage reveals the panel and puts its
playhead at the beat that passage is boarded as (`ui.soundSeek`, transient and
consumed once). A passage with no storyboard has no place on that scale and is
told so, rather than being given a playhead somewhere arbitrary.

**Not done.** No waveform (it needs a decode per clip and a canvas per lane, and
the clip's name and length answer "what is this" first); no fades or per-clip
volume curves; no track solo; no clip copy and paste; the share projection does
not carry sound; and sound takes no part in the timeline's coverage, which is
about what is boarded and what is sourced.

### 6.1 What landed after the first pass

**Solo** (`audibleTracks`) is the conventional rule and not a second kind of
mute: with anything soloed only the soloed tracks are heard, and mute still
wins on the same track. Both exist because they answer different questions,
"not this one" and "only this one", and a writer checking one line against
picture reaches for the second without having to mute the other five.

**Colour tags** are the writer's own sorting: effects one way, music another. A
track carries one of the six project colours and its clips take it unless a
clip sets its own, which is what someone who colours a whole track means.
`clipColor` is the single definition, because the sound panel and the timeline
must not disagree about what colour a piece of sound is.

**Zoom** goes through one path (`#zoomTo`) that holds the time under a fixed
point on screen: the pointer for a trackpad pinch (which arrives as a wheel
event with ctrlKey) or Ctrl-wheel, the midpoint for a two-finger pinch, the
middle of the pane for the buttons. Without that, zooming out walks the
arrangement off the left edge and the writer scrolls back to find what they
were looking at. The floor is 0.25 px/s, set by what zooming out is FOR (two
hours in 1800px) rather than by what looks tidy, and Fit goes straight to the
zoom that fits the pane.

**The timeline's Sound row** is the mixdown of every track. It reaches a script
element through the storyboard that element is boarded as, because that is how
sound is anchored (section 6): an element with no board can carry no sound,
which is the model being honest rather than the row being incomplete. It counts
muted and un-soloed tracks, since mute and solo are monitoring states a writer
flips a dozen times an hour, and a row that emptied itself every time someone
auditioned a track would be reporting the wrong thing.

**The Storyboard row's key colours** (`utils/key-color.js`) make the row read as
the film's palette. A bar is often two or three pixels wide, so a thumbnail
would be a smear; the colour of the thumbnail is the part that survives at that
size, and the frame itself is one hover away.

The row has three states and nothing else. A beat drawn with a FINAL frame is
solid in that frame's key colour. A beat whose storyboard holds only a
REFERENCE frame is that frame's key colour hatched, because it is the beat as it
was imagined and not as it will be shot; where a storyboard has both frames the
final one wins, in colour and in solidity. A BLANK storyboard is a flat grey: a
claim on the passage with no picture in it, which is why it is drawn at all and
why it is still not boarded (hard rule 3). The hatch rather than a second hue is
what carries final against reference, because both bars are now painted from
their own frame and two frames of the same shot would otherwise be told apart by
nothing. It is drawn per bar rather than once across the row, which is how it
was drawn when every reference bar was the same orange.

A colour on its way to a bar passes through `readableKeyColor`, which holds it
at or below Oklab L .68 with its hue and relative chroma kept. A storyboard
drawn in pencil on white paper has a near-white key colour: true of the frame,
and useless on a pale track, where the bar would say nothing is there. It comes
down to a plain grey instead, a step darker than the grey a blank storyboard
takes, so a beat someone has drawn still reads darker than a beat someone has
only claimed. Everything already readable passes through untouched, and solid
never becomes hatched: solid means a final frame whatever colour it came out.

**The Reference row** takes its colours from the sources themselves. A bar
divides equally into one band per source backing that beat, each in that
source's own colour, so a beat resting on three sources shows all three instead
of hiding two behind one. A source with no colour of its own is the plain grey,
which is also what a source deleted out from under its link reads as. The colour is one weighted average
over every pixel of a 32x32 reading of the frame, where the weight is how much
colour that pixel carries: `BASE + chroma * visible(lightness) * agrees(hue)`.
Nothing is thresholded and nothing is discarded, so two frames that look alike
cannot come out unalike. BASE is the vote every pixel has in the frame's level,
so a frame with no colour in it (black, grey, a black-and-white still) comes out
as its plain average. Chroma is Oklab's, which means the same thing at every
lightness; RGB max-min does not, and a night frame could never win its own
colour under it. `visible()` is Oklab L cubed, which undoes the cube root in L
and gives back the light the pixel actually puts out, so a dark room cannot
outvote the one lit thing in it by sheer pixel count; blown highlights are held
back at the other end. `agrees()` damps the hue opposite the dominant one (found
from a smoothed 24-bucket histogram of the same weight), so a red subject on a
cyan wall cannot average into grey. The average is taken in Oklab and converted
back, so the answer is always a real mixture of the frame's own colours.

The read itself is deliberately careful, because a bar that cannot be read falls
back to the plain storyboard green and says nothing about the frame: the
downscale is done by halves (one 125:1 draw is free to sample, and a lit face a
few pixels wide can fall between the samples), at most four frames decode at
once (a project is dozens of photographs, and a browser that runs out of room
starts refusing), a draw that produces nothing is tried again through
`createImageBitmap`, and a frame that fails is given one more chance the next
time it is asked for rather than being written off. Read asynchronously, cached
by the image's own data, and never stored in the project: it is derived from the
frame and can always be derived again.

## 7. Undo and redo, per panel

One stack for the whole app would be wrong here, and not as a matter of taste.
These panels are worked in side by side: a writer lays sound against the
storyboard with the script open beside it, so a single stack means Cmd+Z in the
sound panel undoing the sentence they typed two minutes ago in the script, or
the other way round. "What does undo mean" only has an answer relative to what
you are working on.

**A thread is a set of project branches**, not a panel: `boards` for the
storyboards (and the timeline, which edits them), `research` + `folders` +
`links` for the references, `sounds` + `tracks` + `clips` for sound. A change
is recorded on a thread if and only if it touched that thread's branches, so
where the change was MADE does not matter: a storyboard created by dropping an
image on a script line is undone from the storyboard thread, because a
storyboard is what it is. That is the only rule that stays true no matter which
panel an action is reachable from, and several are reachable from three.

**The script is deliberately absent.** It has CodeMirror's own history, per
draft, which also restores the link anchors an edit moved (item 31). Routing
Cmd+Z here while the caret is in the script would undo a board or a comment
while the writer was looking at a sentence.

**An entry is the branch references as they stood**, not a copy and not a diff.
Every reducer in `data/` is pure and returns new arrays rather than mutating
them, so the old array is still intact and still correct, and holding it costs
one pointer. `state/history.js` says this out loud because it is a dependency on
a property of other modules: a reducer that mutated an array in place would
quietly make every entry on its thread a lie. The depth is capped at 60 per
thread, since an entry holds whole collections and those hold data URLs.

**Clearing.** Threads are forgotten when another project opens and when a merge
replaces the collections wholesale. An entry recorded before a merge holds the
collections as THIS device had them, and applying one afterwards would put them
back over what was merged in, which is the one outcome a three-way merge exists
to prevent.

**Routing** is "the pane you last pressed in" (`state/active-panel.js`), not
"the pane under the pointer": moving the mouse to reach for Cmd+Z must not
change what Cmd+Z means. It is kept out of the store's ui branch on purpose,
because it changes on every press inside any pane and in the store that would
re-render every panel in the layout on every click, the script editor included.
Nothing renders from it; the keyboard router reads it when a key is pressed and
the pane menus read it when they open. A text field, a contenteditable, and an
event CodeMirror already answered (`defaultPrevented`) are all left alone.

## 8. A format per draft

Pandemonium is built around Fountain, and the final draft of a screenplay is a
Fountain document. But a draft is not always a screenplay yet: the first one is
usually prose, a treatment, an outline, a list of beats. Read as Fountain, that
prose is rewritten in front of the writer, because Fountain reads meaning into
shapes ordinary prose has by accident: a line in capitals is a character cue, a
line ending in "TO:" is a transition, a leading dot forces a scene heading,
`/* */` disappears into a boneyard, `[[ ]]` becomes a note. Hard rule 2 is about
never corrupting a Fountain document; a plain-text document has the same claim
on being left alone.

So each draft carries a format (`data/formats.js`): `text`, `markdown` or
`fountain`. **A new draft is plain text**, and the dropdown left of Focus
switches it.

**One other parser** (`fountain/plain.js`): one block per non-blank line, every
one a paragraph, nothing read in. Everything downstream of the parser works on
`parsed.blocks`, so the page layout, the minimap, the word count, the estimate,
the links and the timeline work unchanged; Markdown shares the parse and adds
only `**bold**` and `*italic*`, which mean the same thing in both formats.

**The format is a facet** (`components/editor/cm-format.js`), not a prop. The
live-preview plugin, the page layout and the minimap each parse the document
themselves on every keystroke, and all three must parse it the same way, or the
sheets would be laid out from one reading of the text while the words were drawn
from another. Changing a draft's format rebuilds the EditorState, the way a
draft switch does, because the extension set itself differs: Fountain has the
element flow (the Enter picker, Tab transforms, auto-uppercase, the case
journal, the summary default, the live preview that hides its own markers) and
the row rail's element pill; Markdown has its own colouring; plain text has
neither.

**Markdown is coloured, not re-typeset.** Weight and colour only, with the
markers left where they stand and dimmed. That is the page's constraint, not a
shortcut: the script page is a real character grid (`paginate.js` lays the
document out in rows and columns of a monospace cell and `cm-pages.js` draws
sheets against it), so a heading set two sizes larger would be taller and wider
than the row it was laid out on and the text would walk off its sheet. Hiding
the markers would mean teaching the page layout a second syntax to keep the row
counts right, for a format where the marker is part of how people read their own
notes. The highlighter is hand-rolled for the same reason the Fountain parser is:
a Markdown grammar package and its lezer dependencies would be a large addition
to colour six line shapes and four inline ones.

**Switching is lossless.** The text is never touched, only how it is read, so a
switch is reversible and every storyboard, reference and comment stays attached:
anchors are found by searching for their own quoted words (`fountain/resolve.js`),
not by block index. A draft from a file written before the setting existed has no
`format` key and reads as Fountain, which is what it is; defaulting those to
plain text would silently restyle every screenplay already saved. An import is
Fountain for the same reason.

## 9. The selection, the dark page, and what can be selected

Three things that were each "a small bug" and shared one theme: the page and its
chrome had been built against the light theme and a code editor's assumptions,
and neither is what a screenplay page is.

### 9.1 The selection is drawn row by row

`drawSelection()` was added so the caret would be one line tall (item 31), and it
brought CodeMirror's own selection rectangles with it. Those are a code editor's:
the first line from the selection's start to the right edge, every line between
as one full-width band, the last line from the left edge to the selection's end.
"Left edge" and "right edge" are measured from the content box, with the padding
of the FIRST `.cm-line` in the DOM standing in for all of them (`measureRange`
in `@codemirror/view`). On a script page that is wrong twice over. The page
margins are the content box's own padding, and every element has its own indent
(a cue 21 characters in, a speech 10), so the band began wherever the first
rendered line's indent put it, cut through the first letters of an action line,
and ran into the right margin. It was visible the moment a selection spanned an
action line and a dialogue line.

`components/editor/cm-selection.js` replaces the rectangles and keeps everything
else. It draws what a word processor draws: each visual row of text from its
first selected character to its last, a character wider on a row whose line
break is selected (so a blank line inside a selection still shows), nothing in
the margins, nothing across a page break.

- **The rows come from the browser.** One DOM range per selected line
  (`view.domAtPos`, start with side 1 and end with side -1 so both resolve into
  the line and never past the page filler that closes the document), and
  `getClientRects()` returns a rect per text run per visual row at the position it
  is actually drawn. That stays true through word wrap, indents, concealed
  markup and whatever is added next, because none of it is modelled.
- **The only arithmetic is vertical.** `foldRows` (pure, tested) merges the runs
  of a row and snaps every row to the line pitch on the first row's grid, so rows
  tile with shared edges instead of leaving a hairline between them. A rect
  taller than a line and a half is not text (a page-gap widget a range strayed
  into) and is dropped.
- **`drawSelection()` stays.** It owns the caret and hides the browser's own
  selection and caret, and the facet that tells CodeMirror the native selection
  is hidden is internal to the package and cannot be set from outside. Only its
  rectangles are retired, by CSS (`.cm-selectionLayer .cm-selectionBackground`),
  which also leaves the iOS selection handles it draws in the same layer.
- **Order matters.** Layers stack in registration order, so the layer is
  registered straight after `drawSelection()` and before the page sheets. Under
  an opaque sheet the selection would not show at all.
- **Cost.** One range measurement per rendered selected line, which is the
  viewport and its margin. Select All in the middle of a 400-scene, 23,000-word
  script rendered 59 lines, drew 96 rectangles and spent 0.3 ms in
  `getClientRects`.
- It dims (13% ink against 22%) when the editor loses focus, the way every editor
  shows a selection that is still there but not live.

**Why selected words went dark in the dark theme.** `global.css` carried
`::selection{background:var(--act);color:var(--act-ink)}`, written when the app
was one HTML file. Highlight pseudo-elements inherit down the flat tree, so after
the move to shadow DOM its `color` reached every shadow root while its
`background` (which is not inherited) reached none. Every selection in the app
had near-black text, and on the dark page the selected words were dark on a dark
wash (measured: `::selection` colour `rgb(22,23,25)` against `rgb(232,230,227)`
for the same line once the rule is gone). The rule is deleted rather than fixed.
What a selection looks like belongs where the text is: the page draws its own, and
a field keeps the platform's.

### 9.2 The page after dark

The page palette (`--pg-*`, tokens.css) was declared once on `:root`, on the
reasoning that the page is a literal choice and not a reading of its surface.
That was right for the link colours' meaning and wrong for the sheet: a white
sheet on a dark desk is a lamp in a dark room, and the writer's eye goes to it
before anything else. The dark theme now re-declares the whole set.

- **Paper** `#26282d`, a step lighter than the desk (`--bg`, `#161719`). The
  contrast is 1.2:1, the same step Material takes for a resting surface on a dark
  theme; in this theme it is the fill that separates the sheet from the desk
  (a shadow is invisible on a dark desk), where in the light theme it is the
  shadow and the corners.
- **Ink** `#e8e6e3` (the app's own `--ink`: warm, because pure white on a dark
  sheet glares). The two steps back are `#b4b2af` and `#8e8f94`, 7:1 and 4.6:1
  against the sheet.
- **Link colours keep their hue and are lifted until they hold**: storyboard
  `#ff6a4d`, reference frame only `#f0956f`, reference `#2bc667`, comment
  `#d4a72c`, each 5:1 or better against the sheet. A writer learns "red is
  boarded, green is sourced" once, and must not have to relearn it after dark.
- **Everything that draws the page reads the tokens**, so nothing else changed:
  the sheet, the selection (a wash of the ink, so it inverts with it), the Add
  page control, the page numbers. The minimap paints into a canvas and reads the
  tokens off the computed style at draw time, which a theme change does not
  trigger on its own, so it now listens to the theme module and redraws.

### 9.3 What can be selected

The app is a tool, not a document. A double-click on a tab, a drag across a
toolbar, or Select All outside a field highlighted labels and word counts and
started stray selections that fought drag and drop, resizing and scrubbing.

**The rule** (`global.css`): `user-select: none` (and the `-webkit-` prefix Safari
still needs) on the `<pandemonium-app>` element. `user-select` resolves down the
flat tree, so that one declaration reaches every component and every shadow root.
It is on the app element and not on `html` or `body` so that nothing the page does
not own (the dev error overlay, an extension's UI) loses its text.

**What is switched back on, and where.** The writing, which is the point of the
app, and the public pages:

- the script (`.cm-content` in `cm-theme.js`);
- every `input`, `textarea` and `contenteditable`, by `selectableStyles`
  (`styles/shared.js`);
- the landing and sign-in pages, which are documents, on their own `:host`.

**Why even editable elements say so.** Chromium exempts an editable element from
an inherited `none`. Safari and Firefox have not always, and Safari has been
known to refuse a caret in one, so each field says "text" itself instead of
depending on the engine making an exception. A field that works in one browser and
not in another is the worst way to get this wrong. Verified here only in
Chromium; Safari and Firefox were not available to run.

**Why a fragment and a test, not a base class or a script.** An ordinary rule does
not cross a shadow boundary, so the declaration has to live in every shadow root
that renders a field. `formStyles` and `panelStyles` include `selectableStyles`,
which covers the dialogs and every panel, and the seven components that style
their own fields spread it directly. `styles/selection-policy.test.js` reads the
component sources and fails the build, naming the file, if one renders an
editable element and carries neither the rule nor a fragment that does (one
documented exception: a field whose template is written in `draft-chip.js` but
renders inside `pd-dialog`). Considered and rejected:

- **Opt-out per component** (`user-select: none` on each piece of chrome): most
  of the 43 components are chrome, so it is the longer list, and the failure mode
  of forgetting one is quiet and permanent clutter, where the failure mode of the
  opt-in is loud and caught by the test.
- **A `selectstart` handler on the document**: imperative, misses keyboard Select
  All, and has to work out from `composedPath()` what counts as writing.
- **A base class that adopts a shared stylesheet into every shadow root**: right
  in the abstract, and a rewrite of every component's `extends` for a one-line
  rule.

Checked in a browser: of the text elements on screen in the default layout, the
five-panel layout, the File menu and Settings, none of the interface text was
selectable and every field and note was; the landing and sign-in pages stayed
fully selectable.

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

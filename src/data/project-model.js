// Pure reducers over the project object: (project, ...args) => newProject.
// Every reducer shallow-clones only the branch it touches (the project
// object itself, plus the one array and the one record inside it that
// changed) and leaves every other record referentially identical. Boards can
// carry multi-megabyte data-URL images in `img`; a plain object/array spread
// only copies the reference to that string, not its contents, so this stays
// cheap. Never JSON-round-trip or structuredClone() the whole project for a
// single-field edit.
'use strict';

import { uid, CHIPCOLORS } from '../utils/format.js';
import { defaultFountain } from './schema.js';
import { researchKind, canMoveFolder } from './research-doc.js';

// ---- scripts ----

// The final draft is always called this, and is the one script that cannot be
// renamed or deleted: it is what storyboard and research links attach to (hard
// rule 4), so it has to exist and has to be identifiable at a glance. A new
// project opens with exactly one other draft, "First Draft" (also reserved,
// also the tab bar's leftmost tab), and everything after that is "Draft N",
// numbered from 2 since "First Draft" already occupies the first slot.
export const FINAL_DRAFT_NAME = 'Final Draft';
export const FIRST_DRAFT_NAME = 'First Draft';

function nextDraftName(project) {
  let max = 0;
  for (const s of project.scripts) {
    if (s.name === FIRST_DRAFT_NAME) { max = Math.max(max, 1); continue; }
    const m = /^Draft (\d+)$/.exec(s.name || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'Draft ' + (max + 1);
}

// Non-final drafts land just before the final draft, so the tab bar reads
// "First Draft, Draft 2 .. Draft N, Final Draft" instead of trailing the
// final tab. Tabs are freely reorderable from there (see reorderScript).
function insertDraft(project, script) {
  const finalIx = project.scripts.findIndex((s) => s.final);
  const scripts = finalIx === -1
    ? [...project.scripts, script]
    : [...project.scripts.slice(0, finalIx), script, ...project.scripts.slice(finalIx)];
  return { ...project, scripts };
}

// A project restored from an autosave or opened from a file can carry a final
// draft named something else ("Draft 1", from before the name was fixed), and
// could even have an ordinary draft squatting on the reserved name. Both are
// corrected on load, so the tab bar always tells the truth about which draft
// owns the links.
export function normalizeDraftNames(project) {
  const used = new Set(project.scripts.filter((s) => !s.final).map((s) => s.name));
  let n = 0;
  const nextFree = () => {
    do { n++; } while (used.has('Draft ' + n));
    used.add('Draft ' + n);
    return 'Draft ' + n;
  };
  return {
    ...project,
    scripts: project.scripts.map((s) => {
      if (s.final) return s.name === FINAL_DRAFT_NAME ? s : { ...s, name: FINAL_DRAFT_NAME };
      return s.name === FINAL_DRAFT_NAME ? { ...s, name: nextFree() } : s;
    }),
  };
}

export function createScript(project, { name, text, final } = {}) {
  const isFinal = final != null ? final : project.scripts.length === 0;
  const script = {
    id: uid(),
    name: name || (isFinal ? FINAL_DRAFT_NAME : nextDraftName(project)),
    text: text != null ? text : defaultFountain(project),
    final: isFinal,
  };
  if (isFinal) return { project: { ...project, scripts: [...project.scripts, script] }, script };
  return { project: insertDraft(project, script), script };
}

export function renameScript(project, id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return project;
  const s = project.scripts.find((x) => x.id === id);
  if (!s || s.final) return project;
  return { ...project, scripts: project.scripts.map((x) => (x.id === id ? { ...x, name: trimmed } : x)) };
}

export function duplicateScript(project, id) {
  const s = project.scripts.find((x) => x.id === id);
  if (!s) return { project, script: null };
  // A copy is never the final draft, so it cannot carry the final name.
  const copy = { id: uid(), name: s.final ? nextDraftName(project) : s.name + ' copy', text: s.text, final: false };
  return { project: insertDraft(project, copy), script: copy };
}

export function deleteScript(project, id) {
  const s = project.scripts.find((x) => x.id === id);
  if (!s || s.final) return project;
  // A draft's own reference links go with it: they anchor to its text and
  // could never resolve anywhere else.
  return { ...project, scripts: project.scripts.filter((x) => x.id !== id), links: (project.links || []).filter((l) => l.scriptId !== id) };
}

// The draft a link belongs to: the one it was made in, else the final draft.
export function linkOwnerId(link, finalId) {
  return link.scriptId || finalId;
}

// The ids of the references a draft has at least one link to (a link to a
// draft that no longer exists is read as the final draft's, as the rest of the
// app reads it).
export function researchIdsInDraft(project, scriptId, finalId) {
  const ids = new Set();
  const known = new Set((project.scripts || []).map((s) => s.id));
  for (const l of project.links || []) {
    const owner = l.scriptId && known.has(l.scriptId) ? l.scriptId : finalId;
    if (owner === scriptId) ids.add(l.researchId);
  }
  return ids;
}

// Moves `id` to just before `beforeId` in tab order (drag-and-drop reorder).
// A null/missing beforeId moves it to the end of the non-final run, i.e. right
// before the final draft. The final draft itself never moves: its tab is
// always the rightmost, matching the reserved name and its unique role as the
// one draft that owns storyboard/research links (hard rule 4).
export function reorderScript(project, id, beforeId) {
  const moving = project.scripts.find((s) => s.id === id);
  if (!moving || moving.final) return project;
  const without = project.scripts.filter((s) => s.id !== id);
  const finalIx = without.findIndex((s) => s.final);
  const targetIx = beforeId ? without.findIndex((s) => s.id === beforeId) : -1;
  const at = targetIx !== -1 ? targetIx : (finalIx !== -1 ? finalIx : without.length);
  return { ...project, scripts: [...without.slice(0, at), moving, ...without.slice(at)] };
}

// Promoting a draft moves the name with the status, so the stored names stay
// honest: exactly one script is ever called "Final Draft".
export function makeFinal(project, id) {
  if (!project.scripts.some((s) => s.id === id)) return project;
  const demoted = nextDraftName(project);
  return {
    ...project,
    scripts: project.scripts.map((s) => {
      if (s.id === id) return { ...s, final: true, name: FINAL_DRAFT_NAME };
      if (s.final) return { ...s, final: false, name: demoted };
      return s;
    }),
  };
}

export function updateScriptText(project, id, text) {
  return { ...project, scripts: project.scripts.map((s) => (s.id === id ? { ...s, text } : s)) };
}

export function importFountain(project, name, text) {
  const script = { id: uid(), name, text, final: false };
  return { project: insertDraft(project, script), script };
}

// ---- boards ----

// Anchors are compared by their quoted text, which is the same thing
// resolve.js searches for, so two boards attached to the same passage stay
// grouped even after the document around them has been edited. Comparing the
// anchor objects by identity or by block index would break the grouping on the
// first edit above them, which is the exact failure the quote-search anchoring
// scheme exists to avoid.
export function anchorKey(parts) {
  return (parts || []).map((p) => p.q || '').join('\x1F');
}

// Where each board sits in the run of boards sharing its passage, as
// {index, length} keyed by board id. The panel needs this to know whether a
// board can move up or down within its own section, and it is derived rather
// than stored so it cannot drift from the boards array it describes.
export function boardRuns(boards) {
  const byKey = new Map();
  for (const b of boards) {
    const key = anchorKey((b.anchor && b.anchor.parts) || []);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(b);
  }
  const out = new Map();
  for (const run of byKey.values()) {
    run.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    run.forEach((b, ix) => out.set(b.id, { index: ix, length: run.length }));
  }
  return out;
}

// Several boards may attach to one section, so they need an order of their
// own: they all resolve to the same script position, and firstBi cannot tell
// them apart. Files written before `seq` existed have none, and a missing
// value reads as 0 with a stable sort, so nothing already saved is
// invalidated by its arrival.
function nextSeq(project, parts) {
  const key = anchorKey(parts);
  let max = -1;
  for (const b of project.boards) {
    if (anchorKey((b.anchor && b.anchor.parts) || []) !== key) continue;
    max = Math.max(max, b.seq || 0);
  }
  return max + 1;
}

// ---- storyboards ----
//
// A storyboard is ONE script passage and the two frames that can stand for it:
// `img` is the final frame and `refImg` the reference frame (inspiration, never
// counted as boarded: hard rule 3). Either can be empty; a storyboard with both
// empty is a blank one, a claim on the passage with nothing drawn yet. So
// making a storyboard from either side always makes the other side too, empty,
// and both modes show the same passage: the frames are all that differs.
// `note` is the storyboard's own comment. It is separate from script comments
// (project.comments), which anchor to script text and know nothing of frames.
//
// The array is still called `boards` (merge, sync and the server key on that
// name); each entry is a storyboard.

export const FRAME_KEY = { final: 'img', reference: 'refImg' };

export function otherMode(mode) { return mode === 'reference' ? 'final' : 'reference'; }

// The image a storyboard holds for a mode ('final' | 'reference'), or null.
export function frameImg(bd, mode) {
  return (bd && bd[FRAME_KEY[mode === 'reference' ? 'reference' : 'final']]) || null;
}

// Boards written before storyboards paired their frames were one board per
// frame, `{img, ref: true|false}`, matched only by sharing an anchor and a
// seq. Fold each such pair into one storyboard, and give every board the
// fields the new shape has. A final board with no reference partner keeps an
// empty reference frame; a reference board with no final partner becomes a
// storyboard whose final frame is empty (its image moves to `refImg`, its id
// is kept). Unlinked boards (no anchor) never pair: nothing says they belong
// together.
//
// Idempotent: a project that is already in the new shape comes back as the
// same object, so it is safe to run on every load and on both sides of a merge.
export function migrateBoards(project) {
  const boards = project.boards || [];
  const stale = boards.some((b) => 'ref' in b || !('refImg' in b) || !('note' in b));
  if (!stale) return project;

  const partsOf = (b) => (b.anchor && b.anchor.parts) || [];
  const pairKey = (b) => anchorKey(partsOf(b)) + '\x1F' + (b.seq || 0);

  const finalByKey = new Map();
  for (const b of boards) {
    if (b.ref || !partsOf(b).length) continue;
    const k = pairKey(b);
    if (!finalByKey.has(k)) finalByKey.set(k, b);
  }
  const partnerOf = new Map(); // final id -> the reference board folded into it
  const folded = new Set(); // reference board ids that no longer stand alone
  for (const b of boards) {
    if (!b.ref || !partsOf(b).length) continue;
    const f = finalByKey.get(pairKey(b));
    if (f && !partnerOf.has(f.id)) { partnerOf.set(f.id, b); folded.add(b.id); }
  }

  const out = [];
  for (const b of boards) {
    if (folded.has(b.id)) continue;
    const { ref, ...rest } = b;
    const partner = partnerOf.get(b.id);
    const next = { ...rest, note: rest.note || '' };
    if (ref) {
      // Reference-only: its image is the reference frame, the final is empty.
      next.refImg = rest.img || null;
      next.img = null;
    } else {
      next.img = rest.img || null;
      next.refImg = (partner && partner.img) || rest.refImg || null;
      if (partner) {
        if (!next.caption && partner.caption) next.caption = partner.caption;
        if (next.dur == null && partner.dur != null) next.dur = partner.dur;
      }
    }
    out.push(next);
  }
  return { ...project, boards: out };
}

// `mode` picks which frame the image goes in ('final' by default); the other
// frame starts empty and can be filled any time.
export function addBoard(project, { parts, img, caption, note, seq, mode }) {
  const board = {
    id: uid(),
    anchor: { parts },
    img: null,
    refImg: null,
    caption: caption || '',
    note: note || '',
    seq: seq != null ? seq : nextSeq(project, parts),
  };
  board[FRAME_KEY[mode === 'reference' ? 'reference' : 'final']] = img || null;
  return { project: { ...project, boards: [...project.boards, board] }, board };
}

// A storyboard with no image in either frame, created from a script section:
// the writer knows a beat needs boarding before there is anything to put
// there. It appears in both storyboards in sequence, plays back as an empty
// slide an image can be dropped onto, and can carry a note.
//
// It does NOT count toward the boarded percentage. See coverage() in
// state/selectors.js: claiming a section is not the same as having drawn it,
// and hard rule 3 does not let the timeline report the one as the other.
export function addBlankBoard(project, { parts, caption, note }) {
  return addBoard(project, { parts, img: null, caption, note });
}

// Put an image in `mode`'s frame for a passage. If a storyboard already on
// that passage has that frame empty (say it was made from the other side), the
// image fills it rather than starting a second storyboard, which is what keeps
// a beat's final and reference together. Otherwise a new storyboard is made.
// Unlinked images (no parts) always start their own.
export function placeFrame(project, { parts, img, mode, caption }) {
  if (parts && parts.length) {
    const key = anchorKey(parts);
    const open = project.boards
      .filter((b) => anchorKey((b.anchor && b.anchor.parts) || []) === key && !frameImg(b, mode))
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))[0];
    if (open) {
      const next = replaceBoardImage(project, open.id, img, mode);
      return { project: next, board: next.boards.find((b) => b.id === open.id) };
    }
  }
  return addBoard(project, { parts, img, caption, mode });
}

// Move a board within the run of boards that share its anchor. Boards attached
// elsewhere keep their own numbering, which is why the run is renumbered
// rather than the whole array.
export function reorderBoard(project, id, delta) {
  const board = project.boards.find((b) => b.id === id);
  if (!board) return project;
  const key = anchorKey(board.anchor && board.anchor.parts);
  const run = project.boards
    .filter((b) => anchorKey((b.anchor && b.anchor.parts) || []) === key)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const from = run.findIndex((b) => b.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= run.length) return project;
  run.splice(to, 0, run.splice(from, 1)[0]);
  const seqById = new Map(run.map((b, ix) => [b.id, ix]));
  return {
    ...project,
    boards: project.boards.map((b) => (seqById.has(b.id) ? { ...b, seq: seqById.get(b.id) } : b)),
  };
}

export function updateBoardCaption(project, id, caption) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, caption } : b)) };
}

// Set (or, with null, clear) one frame of a storyboard. Defaults to the final
// frame; the other frame is never touched.
export function replaceBoardImage(project, id, img, mode = 'final') {
  const key = FRAME_KEY[mode === 'reference' ? 'reference' : 'final'];
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, [key]: img || null } : b)) };
}

// The storyboard's own comment, separate from script comments.
export function setBoardNote(project, id, note) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, note: note || '' } : b)) };
}

// Recorded pacing: how long this board held the screen, in seconds, captured by
// stepping the slideshow in record mode. Feeds a more accurate project duration
// and the timeline's per-element widths than the word-count estimate does.
export function setBoardDuration(project, id, secs) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, dur: secs } : b)) };
}

// Swap a storyboard's two frames. With one side empty this is a move: the image
// goes to the other frame and this one is left empty, still on the same passage.
export function swapBoardFrames(project, id) {
  return {
    ...project,
    boards: project.boards.map((b) => (b.id === id ? { ...b, img: b.refImg || null, refImg: b.img || null } : b)),
  };
}

// A moved board takes a fresh seq at its new anchor: carrying its old position
// over would drop it into the middle of a run it has never been part of.
export function reattachBoard(project, id, parts) {
  const seq = nextSeq(project, parts);
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, anchor: { parts }, seq } : b)) };
}

export function deleteBoard(project, id) {
  return { ...project, boards: project.boards.filter((b) => b.id !== id) };
}

// ---- research ----
//
// One record per source, holding any combination of media, a URL and notes.
// `kind` is not chosen by the caller any more: it is derived from what the
// source actually holds (see researchKind) and re-derived on every edit, so a
// note that gains a URL, or a link that gains notes, tells the truth about
// itself afterwards. Callers may still pass a kind; it is ignored, which is
// what keeps old call sites honest instead of silently authoritative.

export function addResearch(project, { title, url, body, attachment, color, folderId } = {}) {
  const doc = {
    id: uid(),
    // Empty, not the literal string "Untitled": every surface names a source
    // through docTitle(), which falls back to the file name, the host, or the
    // first line of the notes. Storing the word put it in the title FIELD, so
    // the writer had to clear it before typing a real name.
    title: (title || '').trim(),
    url: (url || '').trim(),
    body: body || '',
    color: color || null,
    // Topics this source belongs to. Free text, deduped, and the project's
    // whole label list is derived from these (see allLabels): nothing to set
    // up before using one, nothing left behind when the last use goes.
    labels: [],
    // The folder it is filed in; null is the top level.
    folderId: folderId && (project.folders || []).some((f) => f.id === folderId) ? folderId : null,
    createdAt: Date.now(),
  };
  if (attachment) doc.attachment = attachment; // {name, mime, data: dataURL}
  doc.kind = researchKind(doc);
  return { project: { ...project, research: [...project.research, doc] }, doc };
}

// The one research edit. Everything else (title, body, url, colour, a piece of
// media arriving later) goes through here so `kind` can never drift from the
// content: patching any field re-derives it.
export function updateResearch(project, id, patch) {
  return {
    ...project,
    research: project.research.map((d) => {
      if (d.id !== id) return d;
      const next = { ...d, ...patch };
      next.kind = researchKind(next);
      return next;
    }),
  };
}


export function deleteResearch(project, id) {
  return {
    ...project,
    research: project.research.filter((d) => d.id !== id),
    links: project.links.filter((l) => l.researchId !== id),
  };
}

// ---- folders (organising references) ----

export function addFolder(project, { name, parentId = null, labels = [] } = {}) {
  const folders = project.folders || [];
  const folder = {
    id: uid(),
    name: (name || '').trim() || 'New folder',
    parentId: parentId && folders.some((f) => f.id === parentId) ? parentId : null,
    labels: labels.slice(),
    createdAt: Date.now(),
  };
  return { project: { ...project, folders: [...folders, folder] }, folder };
}

export function updateFolder(project, id, patch) {
  return { ...project, folders: (project.folders || []).map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)) };
}

export function moveFolder(project, id, parentId) {
  const folders = project.folders || [];
  if (!canMoveFolder(folders, id, parentId)) return project;
  return { ...project, folders: folders.map((f) => (f.id === id ? { ...f, parentId: parentId || null } : f)) };
}

export function moveResearch(project, id, folderId) {
  const fid = folderId && (project.folders || []).some((f) => f.id === folderId) ? folderId : null;
  return { ...project, research: project.research.map((d) => (d.id === id ? { ...d, folderId: fid } : d)) };
}

// Deleting a folder never deletes what is in it: its references and folders
// move up to the folder's own parent.
export function deleteFolder(project, id) {
  const folders = project.folders || [];
  const f = folders.find((x) => x.id === id);
  if (!f) return project;
  const up = f.parentId && folders.some((x) => x.id === f.parentId) ? f.parentId : null;
  return {
    ...project,
    folders: folders.filter((x) => x.id !== id).map((x) => (x.parentId === id ? { ...x, parentId: up } : x)),
    research: project.research.map((d) => (d.folderId === id ? { ...d, folderId: up } : d)),
  };
}

// ---- links (script <-> research) ----

// `scriptId` is the draft the link was made in, and is only recorded for a
// draft that is NOT the final one. A link with no scriptId belongs to the final
// draft and follows it if another draft is promoted (the original behaviour);
// one with a scriptId stays with that draft. The caller passes the id only for
// a non-final draft (see store.addLink).
export function addLink(project, { researchId, sParts, rParts, scriptId }) {
  const link = { id: uid(), anchor: { parts: sParts }, researchId, rAnchor: rParts ? { parts: rParts } : null };
  if (scriptId) link.scriptId = scriptId;
  return { project: { ...project, links: [...project.links, link] }, link };
}

export function reattachLink(project, id, parts) {
  return { ...project, links: project.links.map((l) => (l.id === id ? { ...l, anchor: { parts } } : l)) };
}

export function deleteLink(project, id) {
  return { ...project, links: project.links.filter((l) => l.id !== id) };
}

// ---- comments (inline editorial notes anchored to a script section) ----
// Unlike a research link, a comment has no second (research) end and no
// connector: it lives entirely inside the script, shown as an inline marker
// and edited in a small box right there (notes.md points i and j). Anchored
// like every other highlight, so it survives edits via resolve.js.

export function addComment(project, { parts, body }) {
  const comment = { id: uid(), anchor: { parts: parts || [] }, body: body || '' };
  return { project: { ...project, comments: [...(project.comments || []), comment] }, comment };
}

export function updateCommentBody(project, id, body) {
  return { ...project, comments: (project.comments || []).map((c) => (c.id === id ? { ...c, body } : c)) };
}

export function reattachComment(project, id, parts) {
  return { ...project, comments: (project.comments || []).map((c) => (c.id === id ? { ...c, anchor: { parts } } : c)) };
}

export function deleteComment(project, id) {
  return { ...project, comments: (project.comments || []).filter((c) => c.id !== id) };
}

// ---- panel layout ----

// The whole tree is replaced on every change. layout-tree.js's own helpers
// already rebuild only the spine they touch and leave every untouched node
// referentially identical, so this stays as cheap as any other reducer here.
export function setLayout(project, layout) {
  return { ...project, layout };
}

// ---- project meta ----

export function updateProjectMeta(project, { name, type, workspace, description, targetMins }) {
  const next = { ...project };
  if (name != null) next.name = name.trim() || project.name;
  if (type != null) next.type = type.trim();
  if (workspace != null) next.workspace = workspace.trim();
  // Only the ends are trimmed: the writer's own line breaks are the point.
  if (description != null) next.description = description.trim();
  if (targetMins != null) next.targetMins = parseInt(targetMins, 10) || 0;
  return next;
}

// Whether a project holds anything a person would miss: written script, a
// board, a reference, a link or a comment. One that was opened and never
// touched is not worth offering back (see the start screen's note about the
// project left in this browser from before accounts were required).
export function hasWork(project) {
  if (!project) return false;
  if ((project.scripts || []).some((s) => s && typeof s.text === 'string' && s.text.trim())) return true;
  return ['boards', 'research', 'links', 'comments'].some((k) => Array.isArray(project[k]) && project[k].length > 0);
}

export function addContributor(project, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return project;
  const contributor = { n: trimmed, color: CHIPCOLORS[project.contributors.length % CHIPCOLORS.length] };
  return { ...project, contributors: [...project.contributors, contributor] };
}

export function removeContributor(project, index) {
  return { ...project, contributors: project.contributors.filter((_, ix) => ix !== index) };
}

export function setContributors(project, contributors) {
  return { ...project, contributors: contributors.slice() };
}

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
  return { ...project, scripts: project.scripts.filter((x) => x.id !== id) };
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

// The seq of the first slot at this anchor that has a board in the OTHER
// mode but none yet in `ref`'s mode -- an open counterpart waiting to be
// filled. Null when every existing slot already has both, or the anchor has
// no boards at all yet, so the caller should start a fresh slot instead (via
// nextSeq). Letting the new board take that exact seq is what keeps it paired
// with the frame that already claimed the position, so switching final/
// reference for that passage shows the same beat either way.
export function openCounterpartSeq(boards, parts, ref) {
  const key = anchorKey(parts);
  const mine = new Set();
  const theirs = [];
  for (const b of boards) {
    if (anchorKey((b.anchor && b.anchor.parts) || []) !== key) continue;
    if (!!b.ref === ref) mine.add(b.seq || 0);
    else theirs.push(b.seq || 0);
  }
  const open = theirs.filter((s) => !mine.has(s)).sort((a, b) => a - b);
  return open.length ? open[0] : null;
}

export function addBoard(project, { parts, img, caption, seq, ref }) {
  const board = {
    id: uid(),
    anchor: { parts },
    img: img || null,
    caption: caption || '',
    seq: seq != null ? seq : nextSeq(project, parts),
    // A reference board is inspiration for a beat, not the final frame: it never
    // counts toward boarded coverage (hard rule 3) and lives in the panel's
    // Reference view. Default false = a final board.
    ref: !!ref,
  };
  return { project: { ...project, boards: [...project.boards, board] }, board };
}

// A board with no image yet, created from a script section: the writer knows a
// beat needs boarding before there is a frame to put there. Identical to any
// other board from here on, so it appears in the panel in sequence and plays
// back as an empty slide that an image can be dropped onto.
//
// It does NOT count toward the boarded percentage. See coverage() in
// state/selectors.js: claiming a section is not the same as having drawn it,
// and hard rule 3 does not let the timeline report the one as the other.
export function addBlankBoard(project, { parts, caption }) {
  return addBoard(project, { parts, img: null, caption });
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

export function replaceBoardImage(project, id, img) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, img } : b)) };
}

// Recorded pacing: how long this board held the screen, in seconds, captured by
// stepping the slideshow in record mode. Feeds a more accurate project duration
// and the timeline's per-element widths than the word-count estimate does.
export function setBoardDuration(project, id, secs) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, dur: secs } : b)) };
}

// Move a board between the final and reference storyboards.
export function setBoardRef(project, id, ref) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, ref: !!ref } : b)) };
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

export function addResearch(project, { kind, title, url, body, attachment } = {}) {
  const doc = { id: uid(), kind: kind || 'note', title: (title || '').trim() || 'Untitled', url: (url || '').trim(), body: body || '' };
  if (attachment) doc.attachment = attachment; // {name, mime, data: dataURL}: opaque, not span-linkable
  return { project: { ...project, research: [...project.research, doc] }, doc };
}

export function updateResearchTitle(project, id, title) {
  return { ...project, research: project.research.map((d) => (d.id === id ? { ...d, title } : d)) };
}

export function updateResearchBody(project, id, body) {
  return { ...project, research: project.research.map((d) => (d.id === id ? { ...d, body } : d)) };
}

export function deleteResearch(project, id) {
  return {
    ...project,
    research: project.research.filter((d) => d.id !== id),
    links: project.links.filter((l) => l.researchId !== id),
  };
}

// ---- links (script <-> research) ----

export function addLink(project, { researchId, sParts, rParts }) {
  const link = { id: uid(), anchor: { parts: sParts }, researchId, rAnchor: rParts ? { parts: rParts } : null };
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

export function updateProjectMeta(project, { name, type, workspace, targetMins }) {
  const next = { ...project };
  if (name != null) next.name = name.trim() || project.name;
  if (type != null) next.type = type.trim();
  if (workspace != null) next.workspace = workspace.trim();
  if (targetMins != null) next.targetMins = parseInt(targetMins, 10) || 0;
  return next;
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

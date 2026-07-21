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
// rule 4), so it has to exist and has to be identifiable at a glance. Every
// other draft is "Draft N", numbered from 1 among the non-final drafts.
export const FINAL_DRAFT_NAME = 'Final Draft';

function nextDraftName(project) {
  let max = 0;
  for (const s of project.scripts) {
    const m = /^Draft (\d+)$/.exec(s.name || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'Draft ' + (max + 1);
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
  return { project: { ...project, scripts: [...project.scripts, script] }, script };
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
  return { project: { ...project, scripts: [...project.scripts, copy] }, script: copy };
}

export function deleteScript(project, id) {
  const s = project.scripts.find((x) => x.id === id);
  if (!s || s.final) return project;
  return { ...project, scripts: project.scripts.filter((x) => x.id !== id) };
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
  return { project: { ...project, scripts: [...project.scripts, script] }, script };
}

// ---- boards ----

export function addBoard(project, { parts, img, caption }) {
  const board = { id: uid(), anchor: { parts }, img, caption: caption || '' };
  return { project: { ...project, boards: [...project.boards, board] }, board };
}

export function updateBoardCaption(project, id, caption) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, caption } : b)) };
}

export function replaceBoardImage(project, id, img) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, img } : b)) };
}

export function reattachBoard(project, id, parts) {
  return { ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, anchor: { parts } } : b)) };
}

export function deleteBoard(project, id) {
  return { ...project, boards: project.boards.filter((b) => b.id !== id) };
}

// ---- research ----

export function addResearch(project, { kind, title, url, body, attachment } = {}) {
  const doc = { id: uid(), kind: kind || 'note', title: (title || '').trim() || 'Untitled', url: (url || '').trim(), body: body || '' };
  if (attachment) doc.attachment = attachment; // {name, mime, data: dataURL} — opaque, not span-linkable
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

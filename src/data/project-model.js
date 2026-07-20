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

export function createScript(project, { name, text, final } = {}) {
  const script = {
    id: uid(),
    name: name || ('Draft ' + (project.scripts.length + 1)),
    text: text != null ? text : defaultFountain(project),
    final: final != null ? final : project.scripts.length === 0,
  };
  return { project: { ...project, scripts: [...project.scripts, script] }, script };
}

export function renameScript(project, id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return project;
  return { ...project, scripts: project.scripts.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) };
}

export function duplicateScript(project, id) {
  const s = project.scripts.find((x) => x.id === id);
  if (!s) return { project, script: null };
  const copy = { id: uid(), name: s.name + ' copy', text: s.text, final: false };
  return { project: { ...project, scripts: [...project.scripts, copy] }, script: copy };
}

export function deleteScript(project, id) {
  const s = project.scripts.find((x) => x.id === id);
  if (!s) return project;
  let scripts = project.scripts.filter((x) => x.id !== id);
  if (s.final && scripts.length && !scripts.some((x) => x.final)) {
    scripts = scripts.map((x, ix) => (ix === 0 ? { ...x, final: true } : x));
  }
  return { ...project, scripts };
}

export function makeFinal(project, id) {
  return { ...project, scripts: project.scripts.map((s) => (s.final === (s.id === id) ? s : { ...s, final: s.id === id })) };
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

// Moving a reference or a folder into a folder, in the two ways it happens:
// choosing a destination from a menu ("Move to folder..."), and dropping the
// thing on a folder (or a breadcrumb). Both end in applyMove, so the rules
// (a folder never goes inside itself) are in one place.
'use strict';

import { dispatch } from '../../utils/events.js';
import { moveTargets, canMoveFolder } from '../../data/research-doc.js';

export const DND_TYPE = 'application/x-pandemonium-ref';

export function startDrag(e, kind, id) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind, id }));
  e.dataTransfer.effectAllowed = 'move';
}

export function isRefDrag(dt) {
  return !!dt && [...(dt.types || [])].includes(DND_TYPE);
}

// Moves what `item` ({kind: 'doc'|'folder', id}) names into `folderId` (null is
// the top level). Returns 'moved', 'same' (already there) or 'refused'.
export function applyMove(store, item, folderId) {
  if (!item || !item.id) return 'refused';
  const project = store.project;
  if (item.kind === 'folder') {
    const f = (project.folders || []).find((x) => x.id === item.id);
    if (!f) return 'refused';
    if ((f.parentId || null) === (folderId || null)) return 'same';
    if (!canMoveFolder(project.folders, item.id, folderId)) return 'refused';
    store.moveFolder(item.id, folderId);
    return 'moved';
  }
  const d = project.research.find((x) => x.id === item.id);
  if (!d) return 'refused';
  if ((d.folderId || null) === (folderId || null)) return 'same';
  store.moveResearch(item.id, folderId);
  return 'moved';
}

export function applyDrop(el, store, dt, folderId) {
  let item = null;
  try { item = JSON.parse(dt.getData(DND_TYPE)); } catch { return; }
  const out = applyMove(store, item, folderId);
  if (out === 'refused' && item && item.kind === 'folder') {
    dispatch(el, 'pandemonium-toast', { message: 'A folder cannot go inside itself.' });
  }
}

// Opens a menu of every place `item` can go. `at` is {anchor} or {x, y}.
export function openMoveMenu(el, store, item, at) {
  const project = store.project;
  const current = item.kind === 'folder'
    ? ((project.folders || []).find((f) => f.id === item.id) || {}).parentId
    : ((project.research.find((d) => d.id === item.id)) || {}).folderId;
  const targets = moveTargets(project.folders, item.kind === 'folder' ? item.id : null);
  const items = targets.map((t) => ({
    label: t.label,
    selected: (current || null) === t.id,
    fn: () => applyMove(store, item, t.id),
  }));
  dispatch(el, 'pandemonium-open-menu', { ...at, items });
}

// Worth offering only when there is somewhere else to go.
export function hasMoveTargets(store, item) {
  const project = store.project;
  const targets = moveTargets(project.folders, item.kind === 'folder' ? item.id : null);
  return targets.length > 1;
}

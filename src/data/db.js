// The persistence seam. Every component that needs to save/open/autosave a
// project calls through here, never through the adapters directly. It now
// dispatches by session mode:
//
//   - local mode (signed out, or backend unreachable): continuous autosave to
//     IndexedDB, exactly as before.
//   - remote mode (signed in): continuous autosave to the backend, keyed by the
//     currently open remote project id (see remote-api-adapter.js).
//
// Explicit file Save/Open stays local in both modes: a .pandemonium.json on disk
// is the portable backup path and does not depend on an account. Swapping the
// backend for another (a different API, or Firebase) is still just another
// adapter behind these functions, with no component or store change.
'use strict';

import { saveProjectToFile, parseProjectFileText } from './local-file-adapter.js';
import { saveCurrentProjectLocally, loadCurrentProjectLocally, clearCurrentProjectLocally } from './local-db.js';
import { saveProjectRemote, loadProjectRemote } from './remote-api-adapter.js';
import { readFileAsText } from '../utils/files.js';
import { session } from './session.js';
import { trackProjectSave } from '../utils/analytics.js';

// File save/open: always local, both modes.
//
// Only the explicit user-initiated save is tracked. autosaveProject() runs
// continuously on every mutation, so an event there would be noise, not a
// signal. No project name is sent: see the note in state/store.js viewInfo.
export function saveProject(project) {
  saveProjectToFile(project);
  trackProjectSave({
    target: 'file',
    session_mode: session.getMode(),
    script_count: project && project.scripts ? project.scripts.length : 0,
    board_count: project && project.boards ? project.boards.length : 0,
    link_count: project && project.links ? project.links.length : 0,
  });
}

export async function openProjectFile(file) {
  const text = await readFileAsText(file);
  return parseProjectFileText(text);
}

// Continuous persistence: routed by mode.
export function autosaveProject(project) {
  if (session.getMode() === 'remote') return saveProjectRemote(project);
  return saveCurrentProjectLocally(project);
}

export function loadAutosavedProject() {
  if (session.getMode() === 'remote') {
    const id = session.getCurrentRemoteId();
    // No remembered project: the start screen (signed in) offers the cloud list.
    return id ? loadProjectRemote(id) : Promise.resolve(null);
  }
  return loadCurrentProjectLocally();
}

// Deselects the open project. In remote mode this only forgets which project is
// open (it never deletes server data); the local IndexedDB slot is always safe
// to clear.
export function clearAutosavedProject() {
  if (session.getMode() === 'remote') {
    session.setCurrentRemoteId(null);
    session.setBase(null);
  }
  return clearCurrentProjectLocally();
}

// Loading a project the user picked from their cloud list. Kept here (rather
// than importing the remote adapter into a component) so components only ever
// know about this seam.
export function loadRemoteProject(id) {
  return loadProjectRemote(id);
}

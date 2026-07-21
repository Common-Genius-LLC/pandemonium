// The persistence seam. Every component that needs to save/open/autosave a
// project calls through here, never through local-file-adapter.js
// or local-db.js directly. Today this forwards to two local adapters: an
// IndexedDB slot the project autosaves into continuously (see
// autosaveProject/loadAutosavedProject), and explicit file save/open (a
// downloaded/opened .pandemonium.json, images and attachments embedded as
// data URLs) for portable backups and sharing. A future backend (Firebase
// or otherwise) is a third adapter implementing the same shape, swapped in
// here -- no component or store code should need to change when that
// happens.
'use strict';

import { saveProjectToFile, parseProjectFileText } from './local-file-adapter.js';
import { saveCurrentProjectLocally, loadCurrentProjectLocally, clearCurrentProjectLocally } from './local-db.js';
import { readFileAsText } from '../utils/files.js';

export function saveProject(project) {
  saveProjectToFile(project);
}

export async function openProjectFile(file) {
  const text = await readFileAsText(file);
  return parseProjectFileText(text);
}

export function autosaveProject(project) {
  return saveCurrentProjectLocally(project);
}

export function loadAutosavedProject() {
  return loadCurrentProjectLocally();
}

export function clearAutosavedProject() {
  return clearCurrentProjectLocally();
}

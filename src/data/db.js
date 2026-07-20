// The persistence seam. Every component that needs to save/open/sample a
// project calls through here, never through local-file-adapter.js directly.
// Today this just forwards to the local-file adapter (a downloaded/opened
// .pandemonium.json, images and attachments embedded as data URLs). A future
// backend (Firebase or otherwise) is a second adapter module implementing
// the same three functions, swapped in here -- no component or store code
// should need to change when that happens.
'use strict';

import { saveProjectToFile, parseProjectFileText } from './local-file-adapter.js';
import { sampleProject } from './sample-project.js';
import { readFileAsText } from '../utils/files.js';

export function saveProject(project) {
  saveProjectToFile(project);
}

export async function openProjectFile(file) {
  const text = await readFileAsText(file);
  return parseProjectFileText(text);
}

export function loadSample() {
  return sampleProject();
}

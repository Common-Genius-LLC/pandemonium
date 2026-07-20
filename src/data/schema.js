// The persisted project shape. This exact shape is what gets written to and
// read back from a .pandemonium.json file, so changing field names here is
// a breaking change for every file a user has already saved.
'use strict';

export const APP_ID = 'pandemonium';
export const SCHEMA_VERSION = 1;

export function emptyProject(overrides) {
  return Object.assign({
    name: 'Untitled',
    workspace: '',
    type: '',
    targetMins: 0,
    contributors: [],
    scripts: [],
    boards: [],
    research: [],
    links: [],
  }, overrides);
}

export function defaultFountain(project) {
  const today = new Date().toISOString().slice(0, 10);
  const author = (project && project.contributors[0] && project.contributors[0].n) || '';
  return 'Title: ' + ((project && project.name) || 'Untitled') +
    '\nCredit: written by\nAuthor: ' + author +
    '\nDraft date: ' + today +
    '\n\nINT. FIRST SCENE - DAY\n\nType your first action line here.\n';
}

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

// A new draft starts empty. It used to open with a stub title page and a
// first scene, which read as content the writer had to delete before they
// could start. The editor shows a "Start writing your script" placeholder
// over the empty document instead (see cm-theme.js), so the invitation costs
// nothing to dismiss.
export function defaultFountain() {
  return '';
}

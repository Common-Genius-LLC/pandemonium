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
    // A few sentences about the film, written on the back of the project's
    // clapperboard. Optional everywhere: files written before it existed have
    // no key and read as empty.
    description: '',
    targetMins: 0,
    contributors: [],
    scripts: [],
    boards: [],
    research: [],
    // Folders the references are filed in (see data/research-doc.js).
    folders: [],
    links: [],
    // The panel arrangement (see data/layout-tree.js). Persisted because a
    // layout is part of how this project is being worked on. Null means "use
    // the default": every project file written before this field existed has
    // no layout key, and store.loadProject seeds one, so nothing already
    // saved is invalidated by its arrival.
    layout: null,
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

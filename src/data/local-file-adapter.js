// Today's persistence: a project is a .pandemonium.json file the user
// explicitly saves (download) and opens (file picker). No backend, no
// accounts. This is one implementation behind the db.js seam -- see db.js
// for why that indirection exists.
'use strict';

import { downloadBlob } from '../utils/files.js';
import { slug } from '../utils/format.js';

export function saveProjectToFile(project) {
  downloadBlob(
    slug(project.name) + '.pandemonium.json',
    'application/json',
    JSON.stringify({ app: 'pandemonium', v: 1, saved: new Date().toISOString(), project }, null, 2),
  );
}

export function parseProjectFileText(text) {
  const j = JSON.parse(text);
  const proj = (j.project && j.project.scripts) ? j.project : (j.scripts ? j : null);
  if (!proj) throw new Error('Not a Pandemonium project file.');
  return proj;
}

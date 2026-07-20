// The bundled "Paper Boats" sample, lifted verbatim from pandemonium_1.html.
// Placeholder board images are generated as inline SVG data URLs using the
// same token colors as the rest of the app, so the sample never depends on
// a network fetch.
'use strict';

import { uid } from '../utils/format.js';

function svgData(inner) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">' + inner + '</svg>');
}

export function sampleProject() {
  const img1 = svgData('<rect width="320" height="180" fill="#eeeeee"/><rect x="24" y="26" width="90" height="70" fill="#dbe6f9"/><circle cx="69" cy="61" r="18" fill="#ffca45"/><rect x="0" y="120" width="320" height="60" fill="#343434"/><rect x="150" y="88" width="120" height="32" fill="#d9d9d9"/><path d="M175 88 L210 60 L245 88 Z" fill="#ffffff"/>');
  const img2 = svgData('<rect width="320" height="180" fill="#dbe6f9"/><rect x="0" y="130" width="320" height="50" fill="#c5ef9c"/><path d="M120 118 L160 86 L200 118 Z" fill="#ffffff"/><rect x="118" y="118" width="84" height="10" fill="#343434"/><circle cx="268" cy="40" r="20" fill="#ffca45"/>');
  const text = 'Title: Paper Boats\nCredit: written by\nAuthor: Common Genius\nDraft date: Sample project\n\nINT. RIVERBANK WORKSHOP - DAY\n\nAn old desk by a window. A hand folds a square of paper, crease by crease.\n\nNARRATOR (V.O.)\nEvery idea starts the same way. Flat. Unremarkable. Waiting for a fold.\n\nThe paper becomes a small boat.\n\nEXT. RIVER - DAY\n\nThe boat sets off. The current takes it gently at first.\n\nNARRATOR (V.O.)\nThe river does not ask where the boat wants to go.\n\nCUT TO:\n\nEXT. RIVER BEND - DUSK\n\nThe boat tilts, rights itself, keeps going.\n\nNARRATOR (V.O.)\nIt only asks how it was folded.\n';
  const alt = 'Title: Paper Boats\nCredit: alt cold open\nAuthor: Common Genius\nDraft date: sketch\n\nEXT. RIVER - DAWN\n\nMist on the water. A paper boat is already mid-current, moving.\n\nNARRATOR (V.O.)\nStart in motion. Explain later.\n';
  const sMain = { id: uid(), name: 'Draft 2', text, final: true };
  const sAlt = { id: uid(), name: 'Cold open sketch', text: alt, final: false };
  const note = { id: uid(), kind: 'note', title: 'Current and fold', url: '', body: 'A boat on a river moves for two reasons at once. The current decides the direction of travel, and the fold decides how the boat meets it.\n\nWatch enough boats and the fold starts to look like the interesting part. Two identical squares of paper, folded differently, take the same bend in completely different ways.' };
  const ref = { id: uid(), kind: 'link', title: 'Paper folding reference', url: 'https://en.wikipedia.org/wiki/Paper_boat', body: 'Basic hull fold, five creases. Good reference stills for the workshop scene.' };
  return {
    name: 'Paper Boats', workspace: 'Sample', type: 'Short', targetMins: 2,
    contributors: [{ n: 'Ashu', color: '#ffc8fa' }, { n: 'Vasu', color: '#c8ffc9' }],
    scripts: [sMain, sAlt],
    boards: [
      { id: uid(), anchor: { parts: [{ q: 'An old desk by a window. A hand folds a square of paper, crease by crease.', b: 1, s: 0 }] }, img: img1, caption: 'Workshop, morning light' },
      { id: uid(), anchor: { parts: [{ q: 'The boat sets off. The current takes it gently at first.', b: 6, s: 0 }] }, img: img2, caption: 'Launch, wide' },
    ],
    research: [note, ref],
    links: [
      { id: uid(), anchor: { parts: [{ q: 'The river does not ask where the boat wants to go.', b: 8, s: 0 }] }, researchId: note.id, rAnchor: { parts: [{ q: 'the fold decides how the boat meets it.', b: 0, s: 0 }] } },
      { id: uid(), anchor: { parts: [{ q: 'crease by crease.', b: 1, s: 0 }] }, researchId: ref.id, rAnchor: null },
    ],
  };
}

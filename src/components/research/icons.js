// The glyphs a research source is marked with, in one place because three
// surfaces show them: the card in the grid, the reader's header, and the
// panel's toolbar. Material Symbols paths on the app's usual 0 -960 960 960
// viewBox, same as the boards panel's toolbar icons. `currentColor` throughout,
// so a glyph takes the colour of whatever it sits in and never needs a token.
'use strict';

import { html } from 'lit';
import { researchKind, mediaKind } from '../../data/research-doc.js';

const PATHS = {
  note: 'M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z',
  link: 'M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z',
  image: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Z',
  video: 'M160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0-80h100l-60-120h-40v120Zm220 0h100l-60-120H320l60 120Zm220 0h100l-60-120H540l60 120Z',
  audio: 'M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z',
  pdf: 'M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z',
  file: 'M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-370h80v370q0 13 8.5 21.5T470-320q13 0 21.5-8.5T500-350v-350q0-42-29-71t-71-29q-42 0-71 29t-29 71v370q0 71 49.5 120.5T470-160q71 0 120.5-49.5T640-330v-390h80v390Z',
  // Toolbar: the file picker, and the search field.
  upload: 'M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z',
  search: 'M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-420q67 0 113.5-46.5T540-580q0-67-46.5-113.5T380-740q-67 0-113.5 46.5T220-580q0 67 46.5 113.5T380-420Z',
};

// One <svg> for a named glyph. The whole element lives in one html template
// (rather than an svg`` fragment nested in it) because the HTML parser already
// puts <svg><path> in the right namespace, and the lit svg tag is only needed
// for a fragment that starts inside SVG context.
export function icon(name) {
  const d = PATHS[name] || PATHS.file;
  return html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d=${d}></path></svg>`;
}

// What a source is marked with: its media type when it carries a file,
// otherwise link or note (see researchKind).
export function sourceIconName(doc) {
  const kind = researchKind(doc);
  if (kind === 'file') return mediaKind(doc.attachment);
  return kind;
}

export function sourceIcon(doc) {
  return icon(sourceIconName(doc));
}

// The word for what a source is, used in tooltips and the reader's header.
const LABELS = { note: 'Note', link: 'Link', image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF', file: 'File' };

export function sourceLabel(doc) {
  return LABELS[sourceIconName(doc)] || 'Source';
}

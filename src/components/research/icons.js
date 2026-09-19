// The research panel's glyphs: the toolbar's, and the picture a file tile
// shows when the file has no still. Material Symbols paths on the app's usual 0 -960 960 960
// viewBox, same as the boards panel's toolbar icons. `currentColor` throughout,
// so a glyph takes the colour of whatever it sits in and never needs a token.
'use strict';

import { html } from 'lit';
import { mediaKind } from '../../data/research-doc.js';

const PATHS = {
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

// The picture in the tile of a file that has no still of its own (a video, an
// audio file, a PDF). This is not a note-or-link badge; sources carry no kind
// marker. It is only what a file looks like when there is nothing to show.
export function mediaIcon(attachment) {
  return icon(mediaKind(attachment));
}

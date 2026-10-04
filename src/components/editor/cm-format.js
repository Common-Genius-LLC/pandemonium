// Which format the editor is reading its document as (see data/formats.js).
//
// A facet rather than a prop passed around, because the things that need it are
// extensions that only ever see a state: the live-preview plugin, the page
// layout and the minimap all parse the document themselves on every keystroke,
// and all three must parse it the same way or the sheets would be laid out
// from one reading of the text while the words were drawn from another.
//
// It is set once per EditorState. Changing a draft's format rebuilds the state
// (script-editor.js), the same way switching drafts does, because the extension
// set itself differs: Fountain has the element flow, Markdown has its own
// colouring, plain text has neither.
'use strict';

import { Facet } from '@codemirror/state';
import { LEGACY_FORMAT } from '../../data/formats.js';

export const scriptFormat = Facet.define({
  combine: (values) => (values.length ? values[0] : LEGACY_FORMAT),
});

export function formatIn(state) {
  return state.facet(scriptFormat);
}

// "Start with Summary" (feature 4): a brand-new, empty script opens as a
// Summary rather than Action, because a writer starts a script from its
// logline, not its first stage direction. "Summary" is the UI name for a
// Fountain synopsis (see element-ops.js), so this is: an empty document's
// first paragraph is a synopsis.
//
// The picker side of this lives in script-editor.js (#caretElementKey reports
// synopsis while the document is empty, so the label reads "Summary" over the
// placeholder). This module owns the text side: the first user input into an
// empty document is rewritten to carry the `= ` synopsis marker, so what the
// writer types is genuinely a synopsis and stays one.
//
// A bare pin is not enough on its own: caretElementFor lets the parser win once
// real text disagrees with the pin (synopsis is not a PIN_OVERRIDE element), so
// without the marker in the text the line would flip straight back to Action on
// the first keystroke. Putting `= ` in the file is what keeps the promise
// honest, matching hard rule 2: the editor never shows an element the saved
// file would not contain.
'use strict';

import { EditorState } from '@codemirror/state';
import { activeElementField } from './cm-autoformat.js';

const SYNOPSIS_MARK = '= ';

export const summaryDefault = EditorState.transactionFilter.of((tr) => {
  // Only the very first input into an otherwise empty document.
  if (!tr.docChanged || !tr.isUserEvent('input')) return tr;
  if (tr.startState.doc.length !== 0) return tr;

  // A default, not a rule: if the writer has already chosen a different element
  // for this line (picker / Tab / element menu pins it), honour that and type
  // plainly. Only the untouched blank line defaults to a Summary.
  const pin = tr.startState.field(activeElementField, false);
  if (pin && pin.el && pin.el !== 'synopsis') return tr;

  // Pasting a whole block (anything with a line break) into a blank script is
  // not "writing a summary": leave a pasted screenplay alone rather than
  // turning its entire first block into one synopsis line.
  let inserted = '';
  tr.changes.iterChanges((fromA, toA, fromB, toB, ins) => { inserted += ins.toString(); });
  if (inserted.includes('\n')) return tr;

  // Prepend the marker in the same transaction (one undo step, sequential so
  // it lands after the user's own insert). The caret maps through the prepend
  // automatically, ending up after the typed text as it should.
  return [tr, { changes: { from: 0, insert: SYNOPSIS_MARK }, sequential: true }];
});

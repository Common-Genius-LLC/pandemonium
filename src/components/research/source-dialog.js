'use strict';

import { html } from 'lit';
import { dispatch } from '../../utils/events.js';

// Shared "new source" dialog, opened both from the Research panel's +Note/
// +Link buttons and from the script selection toolbar's "Note"/"Source"
// actions (which pass the pending script selection as `parts` so the new
// source is linked immediately). One place, so the two entry points can't
// drift apart.
export function openSourceDialog(el, store, parts, presetKind) {
  const kind = presetKind || 'note';
  dispatch(el, 'pandemonium-open-dialog', {
    title: parts ? 'New source for this passage' : 'New source',
    okLabel: 'Create',
    body: html`
      <div class="field"><label class="lbl">Title</label><input type="text" id="f_title" placeholder="Working memory, Baddeley 2003"></div>
      <div class="row">
        <div class="field"><label class="lbl">Kind</label>
          <select id="f_kind">
            <option value="note" ?selected=${kind === 'note'}>Note</option>
            <option value="link" ?selected=${kind === 'link'}>Link</option>
          </select>
        </div>
        <div class="field"><label class="lbl">URL</label><input type="url" id="f_url" placeholder="https://"></div>
      </div>
      <div class="field"><label class="lbl">Body</label><textarea id="f_body" placeholder="Paste or write the material. A blank line starts a new paragraph."></textarea></div>
    `,
    onOk: (root) => {
      const doc = store.addResearch({
        kind: root.querySelector('#f_kind').value,
        title: root.querySelector('#f_title').value.trim() || 'Untitled',
        url: root.querySelector('#f_url').value.trim(),
        body: root.querySelector('#f_body').value,
      });
      if (parts) store.addLink({ researchId: doc.id, sParts: parts, rParts: null });
      dispatch(el, 'pandemonium-toast', { message: parts ? 'Source created and linked.' : 'Source created.' });
    },
  });
}

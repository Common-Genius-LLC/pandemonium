// Asking before something is deleted, from anywhere in the app.
//
// The browser's confirm() is a system window: it cannot be styled, it cannot be
// anchored to the control that asked, and it blocks the page while it is up.
// The design has its own question instead (confirm-bubble.js, Figma "Delete
// Dialogue box"), a small bubble whose pointer touches the thing being talked
// about. This is how any component reaches it without holding state of its own:
//
//   if (!await askConfirm(this, { anchor: card, question: 'Delete this folder?' })) return;
//
// The request travels as a bubbling event, like every other cross-component
// signal here (utils/events.js), and the app's single host answers it
// (confirm-host.js). If nothing answers -- a component used outside the app
// shell, or a unit test -- it falls back to the browser's confirm rather than
// returning a silent "no", because a confirmation that quietly fails closed
// would look to the writer like a dead button.
'use strict';

import { dispatch } from '../../utils/events.js';

export function askConfirm(el, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(!!v); } };
    // `handled` is set synchronously by the host while the event is dispatching.
    const detail = { ...opts, handled: false, respond: done };
    dispatch(el, 'pandemonium-confirm', detail);
    if (!detail.handled) done(window.confirm(opts.question || 'Are you sure?'));
  });
}

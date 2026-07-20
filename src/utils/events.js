// Every cross-component signal in this app (open a dialog, show a toast,
// open a menu, report a selection/highlight rect for the floating overlay
// layer) is a bubbling + composed CustomEvent dispatched from wherever it
// happens and caught once at pandemonium-app. `composed: true` is what lets
// these cross shadow-root boundaries; components never reach into each
// other's shadow trees or hold direct references to siblings.
'use strict';

export function dispatch(el, name, detail) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

// Which panel the writer is working in, for the one thing that has to know:
// routing Cmd+Z to that panel's own undo thread (state/history.js).
//
// Deliberately NOT in the store's ui branch. It changes on every press inside
// any pane, and in the store that would emit a change and re-render every
// panel in the layout on every click, including the script editor. Nothing
// renders from this; the keyboard router reads it at the moment a key is
// pressed, and the pane menus read it when they open.
//
// The last pane PRESSED IN, rather than the one under the pointer: a writer who
// moves the mouse away to reach for Cmd+Z must not thereby change what Cmd+Z
// means.
'use strict';

let active = { content: null, leafId: null };

export function setActivePanel(content, leafId = null) {
  if (active.content === content && active.leafId === leafId) return;
  active = { content, leafId };
}

export function getActivePanel() {
  return active;
}

export function clearActivePanel() {
  active = { content: null, leafId: null };
}

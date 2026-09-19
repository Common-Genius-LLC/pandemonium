// Cross-panel interactions that are really just store-state changes, not
// DOM events: opening a script<->research pair (switches view/split, opens
// the doc, may switch the active draft) is the same regardless of which
// panel's highlight the user clicked, so both script-panel and
// research-reader call this directly instead of each reimplementing it or
// round-tripping through a bespoke event.
'use strict';

export function openPair(store, id) {
  const finalState = store.getFinalState();
  const item = finalState.R.links.find((o) => o.lk.id === id);
  if (!item) return;
  // Revealing a pair opens the linked source and marks the pair. It shows
  // wherever a Research pane is visible, so make sure one is: clicking a
  // research highlight in the script used to do nothing visible at all on a
  // layout with no research pane.
  store.revealContent('research');
  const patch = { pair: id, openDoc: item.lk.researchId };
  if (store.activeScript().id !== finalState.fsc.id) patch.draftId = finalState.fsc.id;
  store.setUI(patch);
}

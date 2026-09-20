// Cross-panel interactions that are really just store-state changes, not
// DOM events: opening a script<->research pair (switches view/split, opens
// the doc, may switch the active draft) is the same regardless of which
// panel's highlight the user clicked, so both script-panel and
// research-reader call this directly instead of each reimplementing it or
// round-tripping through a bespoke event.
'use strict';

export function openPair(store, id) {
  const lk = store.project.links.find((l) => l.id === id);
  if (!lk) return;
  // The draft that owns the link: the one it was made in, else the final one.
  // Showing a pair means showing it where it lives, which for a reference made
  // in another draft is that draft, not the final one.
  const finalId = store.finalScript().id;
  const owner = lk.scriptId && store.project.scripts.some((x) => x.id === lk.scriptId) ? lk.scriptId : finalId;
  const item = store.getDraftState(owner).R.links.find((o) => o.lk.id === id);
  if (!item) return;
  // Revealing a pair opens the linked source and marks the pair. It shows
  // wherever a References pane is visible, so make sure one is: clicking a
  // reference highlight in the script used to do nothing visible at all on a
  // layout with no References pane.
  store.revealContent('research');
  const patch = { pair: id, openDoc: item.lk.researchId };
  if (store.activeScript().id !== owner) patch.draftId = owner;
  store.setUI(patch);
}

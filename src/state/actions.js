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
  const patch = { pair: id };
  const nextView = store.ui.view === 'single' ? 'split' : store.ui.view;
  patch.view = nextView;
  if (nextView === 'split') patch.split = 'research';
  patch.openDoc = item.lk.researchId;
  patch.readerEdit = false;
  if (store.activeScript().id !== finalState.fsc.id) { patch.draftId = finalState.fsc.id; }
  store.setUI(patch);
}

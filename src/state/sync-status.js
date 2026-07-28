// What the status dot in the title bar reports: whether the work on screen has
// actually been written yet.
//
// Deliberately NOT a branch of PandemoniumStore. Every store mutation emits a
// change event, and app-root schedules an autosave on that event, so recording
// the outcome of a save back into the store would emit another change, schedule
// another save, and the app would autosave forever on a 1.5 second heartbeat.
// Keeping this outside the store breaks that cycle: nothing here ever feeds the
// autosave trigger.
//
// Same shape as data/session.js and state/theme.js (a small EventTarget), so a
// component subscribes directly rather than through the store.
//
//   pending  changes exist that have not been written yet, or a write is in
//            flight. One state, not two: from the writer's point of view
//            "typed but not saved" and "saving right now" are the same answer
//            to "is my work safe".
//   synced   everything on screen has been written.
//   failed   the last write was refused or could not be reached. This is the
//            one the dot exists for.
'use strict';

class SyncStatus extends EventTarget {
  #state = 'synced';
  #detail = '';

  get state() { return this.#state; }
  get detail() { return this.#detail; }

  markPending() { this.#set('pending', ''); }
  markSynced() { this.#set('synced', ''); }
  markFailed(detail) { this.#set('failed', detail || ''); }

  #set(state, detail) {
    if (this.#state === state && this.#detail === detail) return;
    this.#state = state;
    this.#detail = detail;
    this.dispatchEvent(new CustomEvent('change'));
  }
}

export const syncStatus = new SyncStatus();

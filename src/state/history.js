// Undo and redo, one thread per panel.
//
// One stack for the whole app would be wrong here, and not as a matter of
// taste. These panels are worked in side by side: a writer lays sound against
// the storyboard with the script open beside it, so a single stack would mean
// Cmd+Z in the sound panel undoing the sentence they typed two minutes ago in
// the script, or the other way round. The question "what does undo mean" only
// has an answer relative to what you are working on.
//
// So each panel has its own thread, and a thread is defined by the project
// branches that panel's work lives in:
//
//   boards    project.boards                            (and the timeline, which edits boards)
//   research  project.research, folders, links
//   sound     project.sounds, tracks, clips
//   script    not here: the editor has CodeMirror's own history, per draft,
//             which also restores the link anchors an edit moved
//             (see invertedEffects in script-editor.js)
//
// A thread records a change if and only if that change touched its branches,
// so where the change was MADE does not matter: a storyboard made by dropping
// an image on a script line is undone from the storyboard thread, because a
// storyboard is what it is. That is the only rule that stays true no matter
// which panel a given action is reachable from, and several of them are
// reachable from three.
//
// WHY A SNAPSHOT IS CHEAP HERE. An entry is not a copy of the project, or a
// diff: it is the branch REFERENCES as they stood ({boards: <that array>}).
// Every reducer in data/ is pure and returns new arrays rather than mutating
// them, so the old array is still intact and still correct, and holding it
// costs one pointer. This depends on that purity; a reducer that mutated an
// array in place would quietly make every entry on its thread a lie.
'use strict';

export const SCOPES = {
  boards: { label: 'Storyboards', branches: ['boards'] },
  research: { label: 'References', branches: ['research', 'folders', 'links'] },
  sound: { label: 'Sound', branches: ['sounds', 'tracks', 'clips'] },
};

// Which thread a panel's Cmd+Z reaches. The script panel is deliberately null:
// its undo is the editor's own, and routing it here would undo a board or a
// comment while the writer was looking at a sentence.
export const PANEL_SCOPE = {
  boards: 'boards',
  timeline: 'boards',
  research: 'research',
  sound: 'sound',
  script: null,
  status: null,
};

export function scopeForPanel(content) {
  return (content && PANEL_SCOPE[content]) || null;
}

export function scopeLabel(scope) {
  return (SCOPES[scope] && SCOPES[scope].label) || '';
}

export function snapshotOf(project, scope) {
  const out = {};
  for (const b of SCOPES[scope].branches) out[b] = project[b];
  return out;
}

export function applySnapshot(project, snap) {
  return { ...project, ...snap };
}

// Which threads a change belongs on. Reference comparison, which is exactly
// right for pure reducers: an untouched branch is the same array it was.
export function changedScopes(before, after) {
  if (!before || !after) return [];
  return Object.keys(SCOPES)
    .filter((scope) => SCOPES[scope].branches.some((b) => before[b] !== after[b]));
}

// Deep enough that a long working session can be stepped back through, shallow
// enough that the oldest entries do not pin audio and image data in memory
// forever (an entry holds whole arrays, and those arrays hold data URLs).
const LIMIT = 60;

export class PanelHistory {
  constructor(limit = LIMIT) {
    this.limit = limit;
    this.past = new Map();
    this.future = new Map();
  }

  #stack(map, scope) {
    let s = map.get(scope);
    if (!s) { s = []; map.set(scope, s); }
    return s;
  }

  // Called with the project as it was and as it now is. A change recorded on a
  // thread clears that thread's redo: the future it led to is gone, which is
  // what every undo stack in every editor means by a new edit.
  record(before, after) {
    for (const scope of changedScopes(before, after)) {
      const past = this.#stack(this.past, scope);
      past.push(snapshotOf(before, scope));
      if (past.length > this.limit) past.shift();
      this.#stack(this.future, scope).length = 0;
    }
  }

  canUndo(scope) { return !!scope && this.#stack(this.past, scope).length > 0; }
  canRedo(scope) { return !!scope && this.#stack(this.future, scope).length > 0; }

  // Returns the project to apply, or null when there is nothing to step back
  // to. The caller must apply it WITHOUT recording (see store.undoPanel), or
  // stepping back would itself become a step to step back from.
  undo(scope, project) {
    if (!this.canUndo(scope)) return null;
    const snap = this.#stack(this.past, scope).pop();
    this.#stack(this.future, scope).push(snapshotOf(project, scope));
    return applySnapshot(project, snap);
  }

  redo(scope, project) {
    if (!this.canRedo(scope)) return null;
    const snap = this.#stack(this.future, scope).pop();
    this.#stack(this.past, scope).push(snapshotOf(project, scope));
    return applySnapshot(project, snap);
  }

  // Every thread forgotten. A different project is open, or the one that is
  // open has been replaced wholesale by a merge: an entry from before that
  // holds the collections as THIS device had them, and applying one after a
  // merge would put them back over the other writer's work.
  clear() {
    this.past.clear();
    this.future.clear();
  }
}

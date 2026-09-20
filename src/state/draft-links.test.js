// Locks the rule that replaced "only the final draft can link": a reference can
// be linked in ANY draft, the link stays with the draft it was made in, and it
// never leaks into the final draft's highlights or the timeline's numbers
// (hard rule 3: the timeline is about the final draft).
'use strict';

import { describe, it, expect } from 'vitest';
import { PandemoniumStore } from './store.js';

const FINAL = 'INT. HOUSE - DAY\n\nShe waits by the door.\n';
const DRAFT = 'INT. HOUSE - DAY\n\nShe waits by the window instead.\n';

function make() {
  const store = new PandemoniumStore();
  store.loadProject({
    scripts: [{ id: 'f', name: 'Final Draft', text: FINAL, final: true }, { id: 'd', name: 'Draft 2', text: DRAFT, final: false }],
    research: [{ id: 'r', title: 'Doors', body: '', url: '', labels: [], kind: 'note' }],
  });
  return store;
}
const part = (q, b, s) => [{ q, b, s }];

describe('a reference linked in another draft', () => {
  it('resolves in that draft and is invisible to the final draft', () => {
    const store = make();
    store.addLink({ researchId: 'r', sParts: part('window', 1, 15), rParts: null, scriptId: 'd' });
    const draft = store.getDraftState('d');
    expect(draft.R.links).toHaveLength(1);
    expect(draft.R.links[0].ok).toBe(true);
    expect(draft.R.biMap[1]).toBeTruthy(); // the words are highlighted in Draft 2
    const fin = store.getFinalState();
    expect(fin.R.links).toHaveLength(0);
    expect(fin.R.biMap[1]).toBeUndefined();
  });
  it('is left unmarked when made in the final draft, so it follows the final draft', () => {
    const store = make();
    const lk = store.addLink({ researchId: 'r', sParts: part('door', 1, 16), rParts: null, scriptId: 'f' });
    expect(lk.scriptId).toBeUndefined();
    expect(store.getFinalState().R.links).toHaveLength(1);
    expect(store.getDraftState('d').R.links).toHaveLength(0);
  });
  it('does not count towards the timeline: sourced coverage is the final draft alone', () => {
    const store = make();
    store.addLink({ researchId: 'r', sParts: part('window', 1, 15), rParts: null, scriptId: 'd' });
    const sc = store.getFinalState().fscenes;
    expect(sc.every((s) => s.nr === 0 && s.fr === 0)).toBe(true);
    store.addLink({ researchId: 'r', sParts: part('door', 1, 16), rParts: null });
    expect(store.getFinalState().fscenes.some((s) => s.nr > 0)).toBe(true);
  });
  it('is found from the reference, in whichever draft it lives, with that draft named', () => {
    const store = make();
    store.addLink({ researchId: 'r', sParts: part('window', 1, 15), rParts: null, scriptId: 'd' });
    store.addLink({ researchId: 'r', sParts: part('door', 1, 16), rParts: null });
    const found = store.researchLinks('r');
    expect(found.map((o) => o.script.name).sort()).toEqual(['Draft 2', 'Final Draft']);
    expect(found.every((o) => o.ok)).toBe(true);
  });
  it('is reported lost, in its own draft, when its words go', () => {
    const store = make();
    store.addLink({ researchId: 'r', sParts: part('window', 1, 15), rParts: null, scriptId: 'd' });
    store.applyLiveEdit('d', 'INT. HOUSE - DAY\n\nShe waits by the stairs instead.\n', null, null, null);
    expect(store.researchLinks('r')[0].ok).toBe(false);
  });
  it('stays with its draft when another draft is promoted, and is deleted with its draft', () => {
    const store = make();
    store.addLink({ researchId: 'r', sParts: part('window', 1, 15), rParts: null, scriptId: 'd' });
    store.makeFinal('d');
    expect(store.finalScript().id).toBe('d');
    expect(store.getFinalState().R.links).toHaveLength(1); // now it IS the final draft's
    store.makeFinal('f');
    store.deleteScript('d');
    expect(store.project.links).toHaveLength(0);
  });
  it('does not put a link-in-progress from one draft into the other', () => {
    const store = make();
    store.setUI({ linking: { from: 'script', parts: part('window', 1, 15), scriptId: 'd' } });
    expect(store.getDraftState('d').R.biMap[1]).toBeTruthy();
    expect(store.getFinalState().R.biMap[1]).toBeUndefined();
  });
});

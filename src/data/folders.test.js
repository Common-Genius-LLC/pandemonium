// Locks how references are filed: folders nest, a folder moves anywhere except
// into itself, deleting one never deletes what is in it, search and topics look
// across every folder at once, and a folder is labelled exactly like a
// reference. Also the reference links a non-final draft can own.
'use strict';

import { describe, it, expect } from 'vitest';
import {
  folderPath, isInsideFolder, canMoveFolder, moveTargets, folderCount, browse, allLabels,
} from './research-doc.js';
import {
  addFolder, updateFolder, moveFolder, moveResearch, deleteFolder, addResearch, addLink, deleteScript, linkOwnerId, researchIdsInDraft,
} from './project-model.js';

const empty = () => ({ research: [], folders: [], links: [], scripts: [] });
function build() {
  let p = empty();
  const a = addFolder(p, { name: 'Costume' }); p = a.project;
  const b = addFolder(p, { name: '1974', parentId: a.folder.id }); p = b.project;
  const c = addFolder(p, { name: 'Locations' }); p = c.project;
  const r1 = addResearch(p, { title: 'Plates', folderId: a.folder.id }); p = r1.project;
  const r2 = addResearch(p, { title: 'Fire report', folderId: b.folder.id, body: 'smoke' }); p = r2.project;
  const r3 = addResearch(p, { title: 'Loose note' }); p = r3.project;
  return { p, A: a.folder, B: b.folder, C: c.folder, r1: r1.doc, r2: r2.doc, r3: r3.doc };
}

describe('folders', () => {
  it('nest, and report their path from the top', () => {
    const { p, A, B } = build();
    expect(folderPath(p.folders, B.id).map((f) => f.name)).toEqual(['Costume', '1974']);
    expect(isInsideFolder(p.folders, B.id, A.id)).toBe(true);
    expect(isInsideFolder(p.folders, A.id, B.id)).toBe(false);
  });
  it('ignore a parent that does not exist, filing the folder at the top level', () => {
    const f = addFolder(empty(), { name: 'X', parentId: 'ghost' }).folder;
    expect(f.parentId).toBeNull();
    const r = addResearch(empty(), { title: 'r', folderId: 'ghost' }).doc;
    expect(r.folderId).toBeNull();
  });
  it('name themselves when given no name', () => {
    expect(addFolder(empty(), {}).folder.name).toBe('New folder');
  });
  it('stop at a cycle instead of looping', () => {
    const cyc = [{ id: 'a', parentId: 'b', name: 'a' }, { id: 'b', parentId: 'a', name: 'b' }];
    expect(folderPath(cyc, 'a').length).toBeLessThanOrEqual(2);
  });
});

describe('moving', () => {
  it('moves a reference into a folder and back to the top', () => {
    const { p, A, r3 } = build();
    const inA = moveResearch(p, r3.id, A.id);
    expect(inA.research.find((d) => d.id === r3.id).folderId).toBe(A.id);
    expect(moveResearch(inA, r3.id, null).research.find((d) => d.id === r3.id).folderId).toBeNull();
  });
  it('refuses a folder that does not exist, filing at the top level', () => {
    const { p, r1 } = build();
    expect(moveResearch(p, r1.id, 'ghost').research.find((d) => d.id === r1.id).folderId).toBeNull();
  });
  it('moves a folder into another, and out again', () => {
    const { p, B, C } = build();
    const moved = moveFolder(p, B.id, C.id);
    expect(moved.folders.find((f) => f.id === B.id).parentId).toBe(C.id);
    expect(moveFolder(moved, B.id, null).folders.find((f) => f.id === B.id).parentId).toBeNull();
  });
  it('never moves a folder into itself or its own descendant', () => {
    const { p, A, B } = build();
    expect(canMoveFolder(p.folders, A.id, A.id)).toBe(false);
    expect(canMoveFolder(p.folders, A.id, B.id)).toBe(false);
    expect(moveFolder(p, A.id, B.id)).toBe(p);
    expect(canMoveFolder(p.folders, B.id, A.id)).toBe(true);
  });
  it('lists the places a folder can go, without itself or anything inside it', () => {
    const { p, A, C } = build();
    expect(moveTargets(p.folders).map((t) => t.label)).toEqual(['References (top level)', 'Costume', 'Costume / 1974', 'Locations']);
    expect(moveTargets(p.folders, A.id).map((t) => t.label)).toEqual(['References (top level)', 'Locations']);
    expect(moveTargets(p.folders, A.id).some((t) => t.id === C.id)).toBe(true);
  });
});

describe('deleting a folder', () => {
  it('moves its references and folders up a level, and deletes nothing else', () => {
    const { p, A, B, r1, r2 } = build();
    const out = deleteFolder(p, A.id);
    expect(out.folders.map((f) => f.name).sort()).toEqual(['1974', 'Locations']);
    expect(out.folders.find((f) => f.id === B.id).parentId).toBeNull();
    expect(out.research.find((d) => d.id === r1.id).folderId).toBeNull();
    expect(out.research.find((d) => d.id === r2.id).folderId).toBe(B.id);
    expect(out.research).toHaveLength(3);
  });
  it('moves contents to the parent when it has one', () => {
    const { p, A, B, r2 } = build();
    const out = deleteFolder(p, B.id);
    expect(out.research.find((d) => d.id === r2.id).folderId).toBe(A.id);
  });
  it('ignores a folder that is not there', () => {
    const { p } = build();
    expect(deleteFolder(p, 'ghost')).toBe(p);
  });
});

describe('browse', () => {
  it('shows one folder at a time: its folders first, then its references', () => {
    const { p, A } = build();
    const top = browse({ research: p.research, folders: p.folders });
    expect(top.folders.map((f) => f.name)).toEqual(['Costume', 'Locations']);
    expect(top.docs.map((d) => d.title)).toEqual(['Loose note']);
    const inA = browse({ research: p.research, folders: p.folders, folderId: A.id });
    expect([inA.folders.map((f) => f.name), inA.docs.map((d) => d.title)]).toEqual([['1974'], ['Plates']]);
  });
  it('shows a reference whose folder was deleted at the top level, not nowhere', () => {
    const { p } = build();
    const orphan = { ...p, research: [...p.research, { id: 'o', title: 'Orphan', folderId: 'gone', labels: [] }] };
    expect(browse({ research: orphan.research, folders: orphan.folders }).docs.map((d) => d.title)).toContain('Orphan');
  });
  it('searches every folder at once, and finds folders by name', () => {
    const { p, A } = build();
    const r = browse({ research: p.research, folders: p.folders, folderId: A.id, query: 'fire' });
    expect(r.flat).toBe(true);
    expect(r.docs.map((d) => d.title)).toEqual(['Fire report']);
    expect(browse({ research: p.research, folders: p.folders, query: 'costume' }).folders.map((f) => f.name)).toEqual(['Costume']);
  });
  it('treats the unlinked filter as across-everything, showing no folders', () => {
    const { p } = build();
    const r = browse({ research: p.research, folders: p.folders, unlinkedOnly: true, linked: new Set() });
    expect(r.flat).toBe(true);
    expect(r.folders).toEqual([]);
    expect(r.docs).toHaveLength(3);
  });
  it('counts what a folder holds directly', () => {
    const { p, A } = build();
    expect(folderCount(p.research, p.folders, A.id)).toBe(2); // Plates + the 1974 folder
  });
});

describe('folder labels', () => {
  it('label a folder like a reference, and the topic list covers both', () => {
    let { p, A, r1 } = build();
    p = updateFolder(p, A.id, { labels: ['Fire', 'Costume'] });
    p = { ...p, research: p.research.map((d) => (d.id === r1.id ? { ...d, labels: ['fire'] } : d)) };
    // Case-insensitive, and the first spelling seen is the one kept.
    expect(allLabels([...p.folders, ...p.research])).toEqual([{ label: 'Fire', count: 2 }, { label: 'Costume', count: 1 }]);
  });
  it('a chosen topic finds folders and references carrying it, across every folder', () => {
    let { p, B, r1 } = build();
    p = updateFolder(p, B.id, { labels: ['Fire'] });
    p = { ...p, research: p.research.map((d) => (d.id === r1.id ? { ...d, labels: ['Fire'] } : d)) };
    const r = browse({ research: p.research, folders: p.folders, labels: new Set(['fire']) });
    expect([r.folders.map((f) => f.name), r.docs.map((d) => d.title)]).toEqual([['1974'], ['Plates']]);
  });
  it('update only the folder asked for, and never its id', () => {
    const { p, A, C } = build();
    const out = updateFolder(p, A.id, { name: 'Wardrobe', id: 'hijack' });
    expect(out.folders.find((f) => f.id === A.id).name).toBe('Wardrobe');
    expect(out.folders.find((f) => f.id === C.id).name).toBe('Locations');
  });
});

describe('reference links in other drafts', () => {
  it('record the draft they were made in, and leave the final draft unmarked', () => {
    const p = { ...empty(), scripts: [{ id: 's1' }, { id: 's2' }] };
    expect(addLink(p, { researchId: 'r', sParts: [] }).link.scriptId).toBeUndefined();
    expect(addLink(p, { researchId: 'r', sParts: [], scriptId: 's2' }).link.scriptId).toBe('s2');
  });
  it('belong to their own draft, or to the final one when unmarked', () => {
    expect(linkOwnerId({ scriptId: 's2' }, 'final')).toBe('s2');
    expect(linkOwnerId({}, 'final')).toBe('final');
  });
  it('go with a draft when it is deleted, and nothing else does', () => {
    const p = { ...empty(), scripts: [{ id: 'f', final: true }, { id: 's2' }], links: [{ id: 'a', scriptId: 's2' }, { id: 'b' }, { id: 'c', scriptId: 'f' }] };
    expect(deleteScript(p, 's2').links.map((l) => l.id)).toEqual(['b', 'c']);
  });
});

describe('the references a draft has', () => {
  const project = { scripts: [{ id: 'f', final: true }, { id: 'd' }], links: [
    { id: '1', researchId: 'a' }, { id: '2', researchId: 'b', scriptId: 'd' }, { id: '3', researchId: 'a', scriptId: 'd' }, { id: '4', researchId: 'c', scriptId: 'gone' },
  ] };
  it('lists each reference once, for the draft that owns the link', () => {
    expect([...researchIdsInDraft(project, 'd', 'f')].sort()).toEqual(['a', 'b']);
  });
  it('gives the final draft its unmarked links, and reads a link to a deleted draft as the final draft\'s', () => {
    expect([...researchIdsInDraft(project, 'f', 'f')].sort()).toEqual(['a', 'c']);
  });
  it('limits browse to those references across every folder, showing no folders', () => {
    const p = build().p;
    const ids = new Set([p.research[1].id]);
    const r = browse({ research: p.research, folders: p.folders, ids });
    expect(r.flat).toBe(true);
    expect(r.docs.map((d) => d.title)).toEqual(['Fire report']);
    expect(r.folders).toEqual([]);
  });
});

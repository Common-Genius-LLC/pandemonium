'use strict';

import { describe, it, expect } from 'vitest';
import { mergeText, resolveSegments, mergeProjects, commitMergedProject, enforceSingleFinal } from './merge.js';

// Fixtures are built through the same helpers a real project passes through,
// so the tests exercise the shapes the merge will actually meet.
function project(overrides) {
  return {
    name: 'P', workspace: '', type: '', targetMins: 0, contributors: [], layout: null,
    scripts: [{ id: 's1', name: 'Final Draft', text: 'INT. ROOM - DAY\n\nAction one.\n\nAction two.', final: true }],
    boards: [], research: [], links: [], comments: [],
    ...overrides,
  };
}

function withText(p, text) {
  return { ...p, scripts: p.scripts.map((s, i) => (i === 0 ? { ...s, text } : s)) };
}

describe('mergeText', () => {
  const base = 'a\nb\nc\nd\ne';

  it('merges edits to different regions silently', () => {
    const r = mergeText(base, 'a\nB\nc\nd\ne', 'a\nb\nc\nd\nE');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nB\nc\nd\nE');
  });

  it('takes an insertion from one side', () => {
    const r = mergeText(base, base, 'a\nb\nnew line\nc\nd\ne');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nb\nnew line\nc\nd\ne');
  });

  it('applies a deletion from one side', () => {
    const r = mergeText(base, 'a\nc\nd\ne', base);
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nc\nd\ne');
  });

  it('merges a deletion on one side with an edit elsewhere on the other', () => {
    const r = mergeText(base, 'a\nc\nd\ne', 'a\nb\nc\nd\nEDITED');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nc\nd\nEDITED');
  });

  it('identical edits on both sides are not a conflict', () => {
    const r = mergeText(base, 'a\nSAME\nc\nd\ne', 'a\nSAME\nc\nd\ne');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nSAME\nc\nd\ne');
  });

  it('conflicts when both sides change the same region differently', () => {
    const r = mergeText(base, 'a\nMINE\nc\nd\ne', 'a\nTHEIRS\nc\nd\ne');
    expect(r.clean).toBe(false);
    const conflicts = r.segments.filter((s) => s.type === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].mine).toEqual(['MINE']);
    expect(conflicts[0].theirs).toEqual(['THEIRS']);
    expect(conflicts[0].base).toEqual(['b']);
  });

  it('keeps a conflict local: surrounding regions still merge', () => {
    const r = mergeText(base, 'a\nMINE\nc\nd\nE-MINE-OK', 'a\nTHEIRS\nc\nd\ne');
    expect(r.clean).toBe(false);
    expect(resolveSegments(r.segments, ['theirs'])).toBe('a\nTHEIRS\nc\nd\nE-MINE-OK');
  });

  it('resolves mine / theirs / both', () => {
    const r = mergeText(base, 'a\nMINE\nc\nd\ne', 'a\nTHEIRS\nc\nd\ne');
    expect(resolveSegments(r.segments, ['mine'])).toBe('a\nMINE\nc\nd\ne');
    expect(resolveSegments(r.segments, ['theirs'])).toBe('a\nTHEIRS\nc\nd\ne');
    expect(resolveSegments(r.segments, ['both'])).toBe('a\nMINE\nTHEIRS\nc\nd\ne');
  });

  // The degraded mode: the base snapshot lives in memory and a reload loses
  // it. Common text must still merge, and genuinely divergent text must
  // become a conflict rather than one side silently winning.
  it('two-way fallback (no base): common regions merge, gaps conflict', () => {
    const r = mergeText(null, 'a\nMINE\nc', 'a\nTHEIRS\nc');
    expect(r.clean).toBe(false);
    const conflicts = r.segments.filter((s) => s.type === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(resolveSegments(r.segments, ['theirs'])).toBe('a\nTHEIRS\nc');
  });

  it('two-way fallback with identical texts is clean', () => {
    const r = mergeText(null, 'a\nb', 'a\nb');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('a\nb');
  });
});

describe('mergeProjects: records', () => {
  it('unions boards added on both sides', () => {
    const base = project({});
    const mine = { ...base, boards: [{ id: 'b1', anchor: { parts: [] }, img: 'x', caption: '', seq: 0 }] };
    const theirs = { ...base, boards: [{ id: 'b2', anchor: { parts: [] }, img: 'y', caption: '', seq: 0 }] };
    const r = mergeProjects(base, mine, theirs);
    expect(r.clean).toBe(true);
    expect(r.project.boards.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('takes a one-sided edit', () => {
    const board = { id: 'b1', anchor: { parts: [] }, img: 'x', caption: 'old', seq: 0 };
    const base = project({ boards: [board] });
    const mine = base;
    const theirs = { ...base, boards: [{ ...board, caption: 'new' }] };
    const r = mergeProjects(base, mine, theirs);
    expect(r.clean).toBe(true);
    expect(r.project.boards[0].caption).toBe('new');
  });

  it('applies a delete against an untouched record', () => {
    const board = { id: 'b1', anchor: { parts: [] }, img: 'x', caption: '', seq: 0 };
    const base = project({ boards: [board] });
    const mine = { ...base, boards: [] };
    const r = mergeProjects(base, mine, base);
    expect(r.clean).toBe(true);
    expect(r.project.boards).toHaveLength(0);
  });

  it('conflicts on delete versus edit', () => {
    const board = { id: 'b1', anchor: { parts: [] }, img: 'x', caption: 'old', seq: 0 };
    const base = project({ boards: [board] });
    const mine = { ...base, boards: [{ ...board, caption: 'edited' }] };
    const theirs = { ...base, boards: [] };
    const r = mergeProjects(base, mine, theirs);
    expect(r.clean).toBe(false);
    const h = r.hunks[0];
    expect(h.kind).toBe('record');
    expect(h.theirs).toBeNull();
    // Accepting their deletion removes the record at commit.
    h.resolution = 'theirs';
    expect(commitMergedProject(r).boards).toHaveLength(0);
  });

  it('conflicts when both edit the same record differently, and both resolutions work', () => {
    const board = { id: 'b1', anchor: { parts: [] }, img: 'x', caption: 'old', seq: 0 };
    const base = project({ boards: [board] });
    const mine = { ...base, boards: [{ ...board, caption: 'mine' }] };
    const theirs = { ...base, boards: [{ ...board, caption: 'theirs' }] };

    const r1 = mergeProjects(base, mine, theirs);
    expect(r1.clean).toBe(false);
    r1.hunks[0].resolution = 'mine';
    expect(commitMergedProject(r1).boards[0].caption).toBe('mine');

    const r2 = mergeProjects(base, mine, theirs);
    r2.hunks[0].resolution = 'theirs';
    expect(commitMergedProject(r2).boards[0].caption).toBe('theirs');
  });

  it('without a base, a record present on only one side is kept, never deleted', () => {
    const mine = project({ boards: [{ id: 'b1', anchor: { parts: [] }, img: 'x', caption: '', seq: 0 }] });
    const theirs = project({});
    const r = mergeProjects(null, mine, theirs);
    expect(r.project.boards.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('mergeProjects: scripts and commit', () => {
  it('merges non-overlapping script edits clean', () => {
    const base = project({});
    const mine = withText(base, 'INT. ROOM - DAY\n\nMINE EDIT.\n\nAction two.');
    const theirs = withText(base, 'INT. ROOM - DAY\n\nAction one.\n\nTHEIR EDIT.');
    const r = mergeProjects(base, mine, theirs);
    expect(r.clean).toBe(true);
    expect(r.project.scripts[0].text).toBe('INT. ROOM - DAY\n\nMINE EDIT.\n\nTHEIR EDIT.');
  });

  it('refuses to commit while a hunk is unresolved', () => {
    const base = project({});
    const mine = withText(base, 'INT. ROOM - DAY\n\nMINE.\n\nAction two.');
    const theirs = withText(base, 'INT. ROOM - DAY\n\nTHEIRS.\n\nAction two.');
    const r = mergeProjects(base, mine, theirs);
    expect(r.clean).toBe(false);
    expect(commitMergedProject(r)).toBeNull();
    r.hunks.forEach((h) => { h.resolution = 'theirs'; });
    expect(commitMergedProject(r).scripts[0].text).toContain('THEIRS.');
  });

  it('takes a script added on their side', () => {
    const base = project({});
    const theirs = { ...base, scripts: [...base.scripts, { id: 's2', name: 'Draft 1', text: 'new', final: false }] };
    const r = mergeProjects(base, base, theirs);
    expect(r.project.scripts.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  // Hard rule 4 at the merge boundary: each side promoted a different draft,
  // and the committed project must end with exactly one final, favoring the
  // merging side's choice.
  it('settles two promoted finals in favor of mine', () => {
    const s1 = { id: 's1', name: 'Final Draft', text: 'a', final: true };
    const s2 = { id: 's2', name: 'Draft 1', text: 'b', final: false };
    const s3 = { id: 's3', name: 'Draft 2', text: 'c', final: false };
    const base = project({ scripts: [s1, s2, s3] });
    const mine = { ...base, scripts: [{ ...s1, final: false }, { ...s2, final: true }, s3] };
    const theirs = { ...base, scripts: [{ ...s1, final: false }, s2, { ...s3, final: true }] };
    const r = mergeProjects(base, mine, theirs);
    const finals = r.project.scripts.filter((s) => s.final);
    expect(finals).toHaveLength(1);
    expect(finals[0].id).toBe('s2');
  });

  it('lets their promotion win when mine did not touch the flags', () => {
    const s1 = { id: 's1', name: 'Final Draft', text: 'a', final: true };
    const s2 = { id: 's2', name: 'Draft 1', text: 'b', final: false };
    const base = project({ scripts: [s1, s2] });
    const theirs = { ...base, scripts: [{ ...s1, final: false }, { ...s2, final: true }] };
    const r = mergeProjects(base, base, theirs);
    const finals = r.project.scripts.filter((s) => s.final);
    expect(finals).toHaveLength(1);
    expect(finals[0].id).toBe('s2');
  });

  it('enforceSingleFinal repairs a project with no final at all', () => {
    const p = project({ scripts: [{ id: 'a', name: 'X', text: '', final: false }] });
    const fixed = enforceSingleFinal(p, null);
    expect(fixed.scripts[0].final).toBe(true);
  });

  it('meta merges field-wise with mine winning ties', () => {
    const base = project({ name: 'Old', targetMins: 10 });
    const mine = { ...base, name: 'Mine' };
    const theirs = { ...base, name: 'Theirs', targetMins: 20 };
    const r = mergeProjects(base, mine, theirs);
    expect(r.project.name).toBe('Mine');       // both changed: mine wins, no hunk
    expect(r.project.targetMins).toBe(20);     // only theirs changed: theirs
    expect(r.hunks).toHaveLength(0);
  });
});

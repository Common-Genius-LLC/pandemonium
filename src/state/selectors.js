// Derived-state computations shared by the timesheet, boards panel, script
// editor and research panel: which board/link anchors currently resolve
// against the final draft, which scene each falls in, and the coverage
// fractions that drive the timeline. All pure; ported from the original
// renderAll()/computeResolved()/coverage() with the same semantics --
// per hard rule 3 ("the timeline math must be honest"), a scene's boarded/
// sourced fraction is only ever computed from anchors that actually resolve;
// it is never estimated or faked when nothing resolves.
'use strict';

import { resolvePart } from '../fountain/resolve.js';
import { sceneIndexOf } from '../fountain/blocks.js';
import { clamp, fmtT } from '../utils/format.js';

// Resolves every board/link anchor against the final draft's freshly parsed
// blocks, plus (if a link-in-progress exists) the pending selection as its
// own highlight kind ('p'). Returns {boards, links, biMap, plains} where
// biMap maps block index -> array of {s,e,cls,id,kind} for blockHTML().
export function computeResolved(parsed, scenes, project, ui) {
  const plains = parsed.blocks.map((b) => b.plain);
  const biMap = {};
  const add = (r, cls, id, kind) => {
    if (!r) return;
    (biMap[r.bi] = biMap[r.bi] || []).push({ s: r.s, e: r.e, cls, id, kind });
  };
  const boards = project.boards.map((bd) => {
    const res = ((bd.anchor && bd.anchor.parts) || []).map((pt) => resolvePart(plains, pt));
    const ok = res.some(Boolean);
    let firstBi = Infinity;
    res.forEach((r) => { if (r && r.bi < firstBi) firstBi = r.bi; });
    res.forEach((r) => add(r, 'hb', bd.id, 'b'));
    return { bd, res, ok, firstBi: ok ? firstBi : Infinity, sceneIdx: ok ? sceneIndexOf(scenes, firstBi) : -1 };
  });
  const links = project.links.map((lk) => {
    const res = ((lk.anchor && lk.anchor.parts) || []).map((pt) => resolvePart(plains, pt));
    const ok = res.some(Boolean);
    let firstBi = Infinity;
    res.forEach((r) => { if (r && r.bi < firstBi) firstBi = r.bi; });
    res.forEach((r) => add(r, 'hr', lk.id, 'r'));
    return { lk, res, ok, firstBi: ok ? firstBi : Infinity, sceneIdx: ok ? sceneIndexOf(scenes, firstBi) : -1 };
  });
  if (ui.linking && ui.linking.from === 'script' && ui.linking.parts) {
    ui.linking.parts.forEach((pt) => { const r = resolvePart(plains, pt); add(r, 'hp', 'pending', 'p'); });
  }
  return { boards, links, biMap, plains };
}

// Mutates the freshly-created `scenes` array in place with per-scene
// resolved-anchor sets and boarded/sourced fractions. Safe because scenesOf()
// always returns brand new scene objects for this call, never shared state.
export function coverage(scenes, R) {
  for (const sc of scenes) { sc.bset = new Set(); sc.rset = new Set(); sc.nb = 0; sc.nr = 0; }
  const put = (arr, setKey, nKey) => {
    for (const it of arr) {
      if (!it.ok) continue;
      if (scenes[it.sceneIdx]) scenes[it.sceneIdx][nKey]++;
      it.res.forEach((r) => { if (r) { const sc = scenes[sceneIndexOf(scenes, r.bi)]; if (sc) sc[setKey].add(r.bi); } });
    }
  };
  put(R.boards, 'bset', 'nb');
  put(R.links, 'rset', 'nr');
  for (const sc of scenes) {
    const denom = Math.max(1, sc.content);
    sc.fb = sc.nb ? clamp(sc.bset.size / denom, 0.12, 1) : 0;
    sc.fr = sc.nr ? clamp(sc.rset.size / denom, 0.12, 1) : 0;
  }
}

export function labelScenes(scenes) {
  let num = 0;
  scenes.forEach((s) => { s.label = s.pre ? 'OP' : String(++num); });
  return scenes;
}

// {pctBoarded, pctSourced, estimate, hasContent} for the timesheet header.
// Per hard rule 3, callers must render "unknown" rather than a number when
// hasContent is false -- there is no honest estimate for an empty script.
export function timesheetStats(scenes, parsedBlocksLength) {
  const total = scenes.reduce((a, s) => a + s.secs, 0);
  const hasContent = parsedBlocksLength > 0;
  const wSum = (k) => scenes.reduce((a, s) => a + s.secs * (s[k] || 0), 0);
  const pctBoarded = total ? Math.round((100 * wSum('fb')) / total) : 0;
  const pctSourced = total ? Math.round((100 * wSum('fr')) / total) : 0;
  const estimate = hasContent ? fmtT(total) : null;
  return { pctBoarded, pctSourced, estimate, hasContent, totalSeconds: total };
}

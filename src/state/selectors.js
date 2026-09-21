// Derived-state computations shared by the timeline, boards panel, script
// editor and research panel: which board/link anchors currently resolve
// against the final draft, which scene each falls in, and the coverage
// fractions that drive the timeline. All pure; ported from the original
// renderAll()/computeResolved()/coverage() with the same semantics --
// per hard rule 3 ("the timeline math must be honest"), a scene's boarded/
// sourced fraction is only ever computed from anchors that actually resolve;
// it is never estimated or faked when nothing resolves.
'use strict';

import { resolvePart } from '../fountain/resolve.js';
import { sceneIndexOf, CONTENT_TYPES } from '../fountain/blocks.js';
import { clamp, fmtT } from '../utils/format.js';
import { frameImg } from '../data/project-model.js';

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
    // A storyboard paints green ('hb') unless its only image is the reference
    // one, when it paints yellow ('hbr'): the same green/yellow split the
    // timeline, minimap and script view use. A blank storyboard is still a
    // real link, so it paints green like any other.
    const refOnly = !bd.img && !!bd.refImg;
    res.forEach((r) => add(r, refOnly ? 'hbr' : 'hb', bd.id, 'b'));
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
  // Comments resolve like any other anchor and paint an inline marker ('hc'),
  // but they carry no research end and never feed coverage/timeline math --
  // they're editorial notes, not evidence that a beat is boarded or sourced.
  const comments = (project.comments || []).map((cm) => {
    const res = ((cm.anchor && cm.anchor.parts) || []).map((pt) => resolvePart(plains, pt));
    const ok = res.some(Boolean);
    let firstBi = Infinity;
    res.forEach((r) => { if (r && r.bi < firstBi) firstBi = r.bi; });
    res.forEach((r) => add(r, 'hc', cm.id, 'c'));
    return { cm, res, ok, firstBi: ok ? firstBi : Infinity };
  });
  if (ui.linking && ui.linking.from === 'script' && ui.linking.parts) {
    ui.linking.parts.forEach((pt) => { const r = resolvePart(plains, pt); add(r, 'hp', 'pending', 'p'); });
  }
  return { boards, links, comments, biMap, plains };
}

// Mutates the freshly-created `scenes` array in place with per-scene
// resolved-anchor sets and boarded/sourced fractions. Safe because scenesOf()
// always returns brand new scene objects for this call, never shared state.
export function coverage(scenes, R) {
  for (const sc of scenes) { sc.bset = new Set(); sc.rset = new Set(); sc.nb = 0; sc.nr = 0; sc.nbPending = 0; }
  const spread = (it, setKey) => {
    it.res.forEach((r) => { if (r) { const sc = scenes[sceneIndexOf(scenes, r.bi)]; if (sc) sc[setKey].add(r.bi); } });
  };

  // A storyboard with no FINAL image is a claim that a beat needs boarding, not
  // evidence that it has been boarded, whether it is blank or holds only a
  // reference frame. It is a real link, so it still paints its highlight in
  // the script and is still reported to the reader, but it is counted into
  // nbPending and contributes nothing to bset. Per hard rule 3 the boarded
  // percentage may never include work that has not happened, and "a
  // placeholder exists" is not the work. Reference frames are inspiration for a
  // beat, not the chosen one, so they never lift a storyboard out of pending.
  for (const it of R.boards) {
    if (!it.ok) continue;
    const sc = scenes[it.sceneIdx];
    if (!it.bd.img) { if (sc) sc.nbPending++; continue; }
    if (sc) sc.nb++;
    spread(it, 'bset');
  }

  for (const it of R.links) {
    if (!it.ok) continue;
    if (scenes[it.sceneIdx]) scenes[it.sceneIdx].nr++;
    spread(it, 'rset');
  }

  for (const sc of scenes) {
    const denom = Math.max(1, sc.content);
    sc.fb = sc.nb ? clamp(sc.bset.size / denom, 0.12, 1) : 0;
    sc.fr = sc.nr ? clamp(sc.rset.size / denom, 0.12, 1) : 0;
  }
}

// Which blocks a storyboard link lands on, and which color each gets, for
// anything that paints a per-line marker (the boards panel's script view). Mirrors what the editor highlights: every storyboard
// that resolves, blank or not (a blank one is still a real link). A storyboard
// reads as `ref` only when its sole image is the reference one; anything else
// (a final image, or blank) reads as `final`, and final wins where a block is
// covered by both. Returns Map<blockIndex, {final, ref}>.
export function boardLinkKinds(resolvedBoards) {
  const kinds = new Map();
  for (const it of resolvedBoards) {
    if (!it.ok) continue;
    const refOnly = !it.bd.img && !!it.bd.refImg;
    for (const r of it.res || []) {
      if (!r) continue;
      const k = kinds.get(r.bi) || { final: false, ref: false };
      if (refOnly) k.ref = true; else k.final = true;
      kinds.set(r.bi, k);
    }
  }
  return kinds;
}


// Guardrail messaging for actions that assume a playable storyboard already
// exists (the slideshow, pacing recording): rather than opening on nothing
// and leaving the user to guess why it's empty, name the specific thing
// missing. `action` is a verb phrase, e.g. "record pacing" or "preview the
// show". Returns null when there is enough to proceed.
export function describeSlideshowGap(fparsed, boards, mode, action) {
  const hasScript = fparsed.blocks.some((b) => b.line != null && b.plain && b.plain.trim());
  if (!hasScript) return `Write some script before you ${action}.`;
  const reference = mode === 'reference';
  const kind = reference ? 'reference' : 'storyboard';
  const imaged = boards.filter((it) => frameImg(it.bd, mode));
  if (!imaged.length) return `Add ${kind} frames before you ${action}.`;
  if (!imaged.some((it) => it.ok)) return `Link your ${kind} frames to the script before you ${action}.`;
  return null;
}

// The order boards are read and played in: down the script by resolved
// position, then by the board's own seq. The second term is not a tiebreak
// nicety. Several boards attached to one passage all resolve to the same
// firstBi, so without seq their order is whatever the sort happens to do, and
// a storyboard sequence with undefined order is not a sequence.
export function boardOrder(a, b) {
  return (a.firstBi - b.firstBi) || ((a.bd.seq || 0) - (b.bd.seq || 0));
}

// The storyboards that resolve onto the script, in the order they are read and
// played: down the script, then by seq within a shared passage. There is one
// entry per storyboard, and every storyboard has BOTH a final and a reference
// frame (either may be empty), so the final and reference views list exactly
// the same beats and switching between them changes only which image fills
// each one.
export function linkedBoards(resolvedBoards) {
  return resolvedBoards.filter((o) => o.ok).sort(boardOrder);
}

// ---- the preview deck ----

// The plain-text lines of one scene, for a slide that has no passage of its own
// to show: the scene's content blocks, capped so a long scene is a digest and
// not a wall (the cap stops it at the first block that takes it past ~340
// characters). Each line carries bi/s/e, its span inside its block's plain
// text, which is how an edit made in the show is spliced back into the script.
export function sceneExcerpt(blocks, sc) {
  const parts = [];
  let n = 0;
  for (let bi = Math.max(0, sc.start); bi <= sc.end && bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (CONTENT_TYPES[b.type] && b.plain) {
      parts.push({ type: b.type, text: b.plain, bi, s: 0, e: b.plain.length });
      n += b.plain.length;
      if (n > 340) break;
    }
  }
  return parts;
}

// One slide of unlinked script never grows past about this many characters:
// a stretch longer than that is dealt across several slides, in order, at
// block boundaries. Nothing is dropped to make it fit, so a long unlinked
// scene between two boards is read in full, a slide at a time.
export const UNLINKED_SLIDE_CHARS = 600;

function chunkLines(lines, max) {
  const chunks = [];
  let cur = [];
  let n = 0;
  for (const l of lines) {
    if (cur.length && n + l.text.length > max) { chunks.push(cur); cur = []; n = 0; }
    cur.push(l);
    n += l.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const byPos = (a, b) => (a.bi - b.bi) || (a.s - b.s);

// What an unlinked stretch is made of: the same lines a digest is (dialogue,
// action and the rest of CONTENT_TYPES), plus scene headings, because a slide of
// script with no picture reads oddly without saying where it is.
const GAP_TYPES = { ...CONTENT_TYPES, scene: 1 };

// The passages storyboards are linked to, as one sorted list of non-overlapping
// {bi, s, e} spans in document order. Two boards on one passage, or on
// overlapping words, are one stretch of linked script here.
function linkedSpans(resolvedBoards) {
  const spans = [];
  for (const it of resolvedBoards) {
    if (!it.ok) continue;
    for (const r of it.res || []) if (r && r.e > r.s) spans.push({ bi: r.bi, s: r.s, e: r.e });
  }
  spans.sort(byPos);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && last.bi === sp.bi && sp.s <= last.e) last.e = Math.max(last.e, sp.e);
    else merged.push({ ...sp });
  }
  return merged;
}

// The script that sits BETWEEN two linked passages and belongs to neither: from
// where one linked span ends to where the next begins, across as many blocks as
// that takes, cut at the words (a paragraph can be linked at both ends with
// unlinked words in the middle). Returns one entry per stretch, each with the
// position it ends at (so the deck can place it) and its lines. Fragments with
// no letter or digit in them (the comma between two linked words) are not
// script worth a slide and are skipped.
function unlinkedGaps(blocks, cover) {
  const piece = (bi, s, e) => {
    const b = blocks[bi];
    if (!b || !GAP_TYPES[b.type] || !b.plain) return null;
    const raw = b.plain.slice(s, e);
    const text = raw.trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return null;
    const lead = raw.length - raw.trimStart().length;
    return { type: b.type, text, bi, s: s + lead, e: s + lead + text.length };
  };
  const gaps = [];
  for (let k = 0; k + 1 < cover.length; k++) {
    const a = cover[k], b = cover[k + 1];
    const lines = [];
    const add = (p) => { if (p) lines.push(p); };
    if (a.bi === b.bi) {
      add(piece(a.bi, a.e, b.s));
    } else {
      add(piece(a.bi, a.e, blocks[a.bi] ? blocks[a.bi].plain.length : 0));
      for (let bi = a.bi + 1; bi < b.bi; bi++) add(piece(bi, 0, blocks[bi] ? blocks[bi].plain.length : 0));
      add(piece(b.bi, 0, b.s));
    }
    if (lines.length) gaps.push({ end: { bi: b.bi, s: b.s }, lines });
  }
  return gaps;
}

// The preview deck, in playing order, as data: one `board` entry per linked
// storyboard and one `unlinked` entry per stretch of script no storyboard
// covers. The show turns these into slides; keeping the plan here keeps it
// pure and testable.
//
// Unlinked script is played, not skipped, wherever it lies BETWEEN two linked
// passages: the rest of a scene after its last board, whole scenes with none,
// and the top of the next scene before its first (see unlinkedGaps). Script
// before the first link and after the last is whole scenes only, each a digest
// (sceneExcerpt), folded into one continuous slide: a scene that carries the
// first or last link contributes only what it links. With no link anywhere the
// whole script is that one slide.
export function slidePlan(blocks, scenes, resolvedBoards) {
  const boards = linkedBoards(resolvedBoards);
  const cover = linkedSpans(boards);

  const edge = (keep) => {
    const lines = [];
    for (const sc of scenes) {
      if (!keep(sc) || sc.end < sc.start) continue;
      const ex = sceneExcerpt(blocks, sc);
      lines.push(...(ex.length ? ex : [{ type: 'scene', text: sc.name }]));
    }
    return lines.length ? [{ type: 'unlinked', lines }] : [];
  };

  if (!cover.length) return edge(() => true);

  const gaps = unlinkedGaps(blocks, cover)
    .flatMap((g) => chunkLines(g.lines, UNLINKED_SLIDE_CHARS).map((lines) => ({ end: g.end, lines })));

  const firstBi = cover[0].bi;
  const lastBi = cover[cover.length - 1].bi;
  const plan = [...edge((sc) => sc.end < firstBi)];
  let g = 0;
  for (const o of boards) {
    const pos = o.res.filter(Boolean).reduce((m, r) => (m && byPos(m, r) <= 0 ? m : r), null);
    while (g < gaps.length && pos && byPos(gaps[g].end, pos) <= 0) {
      plan.push({ type: 'unlinked', lines: gaps[g++].lines });
    }
    plan.push({ type: 'board', o });
  }
  while (g < gaps.length) plan.push({ type: 'unlinked', lines: gaps[g++].lines });
  plan.push(...edge((sc) => sc.start > lastBi));
  return plan;
}

export function labelScenes(scenes) {
  let num = 0;
  scenes.forEach((s) => { s.label = s.pre ? 'OP' : String(++num); });
  return scenes;
}

// How much of the outline is actually written, as opposed to how much of it is
// boarded or sourced. A scene heading with nothing under it is a plan, not a
// script (see scenesOf in fountain/blocks.js), and this is the split the
// timeline draws as filled versus empty blocks.
//
// Measured by SCENE COUNT, not by seconds. An unwritten scene has no duration
// to weight it by, so a seconds-weighted percentage would quietly compute
// "written / written" and report every script as 100% written. Hard rule 3.
export function scriptProgress(scenes) {
  const total = scenes.length;
  const scripted = scenes.reduce((a, s) => a + (s.scripted ? 1 : 0), 0);
  return {
    scenes: total,
    scripted,
    planned: total - scripted,
    pctScripted: total ? Math.round((100 * scripted) / total) : 0,
  };
}

// {pctBoarded, pctSourced, estimate, hasContent, totalSeconds} for the
// timeline panel. Per hard rule 3, callers must render "unknown" rather than a
// number when hasContent is false: there is no honest estimate for an empty
// script. pctBoarded excludes blank boards, because coverage() never puts them
// in bset (see the note there).
//
// `estimate` is the running time of what is WRITTEN. Unscripted scenes carry
// 0 seconds (blocks.js), so they cannot inflate it; scriptProgress() above is
// what reports how much is still outstanding.
export function timelineStats(scenes, parsedBlocksLength) {
  const total = scenes.reduce((a, s) => a + s.secs, 0);
  const hasContent = parsedBlocksLength > 0;
  const wSum = (k) => scenes.reduce((a, s) => a + s.secs * (s[k] || 0), 0);
  const pctBoarded = total ? Math.round((100 * wSum('fb')) / total) : 0;
  const pctSourced = total ? Math.round((100 * wSum('fr')) / total) : 0;
  const estimate = hasContent ? fmtT(total) : null;
  return { pctBoarded, pctSourced, estimate, hasContent, totalSeconds: total };
}

// Everything attached to one script element (a block): its storyboards, its
// references and its comments, as the resolved entries from computeResolved.
// This is what a click on any linked words shows, so a beat that has a
// storyboard AND a reference AND a comment shows all three together, whichever
// of its words was clicked.
export function attachedTo(R, bi) {
  const hits = (list) => (list || []).filter((o) => o.ok && (o.res || []).some((r) => r && r.bi === bi));
  return { boards: hits(R.boards), links: hits(R.links), comments: hits(R.comments) };
}

// Per script element, which kinds of link it carries, for anything that marks
// linked lines (the minimap). A storyboard reads as `board: 'final'` when it
// holds a final frame or is blank (a real claim on the beat), `'ref'` when its
// only image is the reference one, and final wins where an element has both.
// Returns Map<blockIndex, {board: 'final'|'ref'|null, ref: boolean, comment: boolean}>.
export function linkKindsByBlock(R) {
  const out = new Map();
  const at = (bi) => { let k = out.get(bi); if (!k) { k = { board: null, ref: false, comment: false }; out.set(bi, k); } return k; };
  for (const it of R.boards || []) {
    if (!it.ok) continue;
    const refOnly = !it.bd.img && !!it.bd.refImg;
    for (const r of it.res || []) if (r) { const k = at(r.bi); k.board = refOnly ? (k.board || 'ref') : 'final'; }
  }
  for (const it of R.links || []) if (it.ok) for (const r of it.res || []) if (r) at(r.bi).ref = true;
  for (const it of R.comments || []) if (it.ok) for (const r of it.res || []) if (r) at(r.bi).comment = true;
  return out;
}

// Three-way project merge, git shaped. This replaces the last-write-wins
// conflict path in remote-api-adapter.js, which silently discarded the other
// writer's work the moment two people (or two devices with real divergence)
// wrote to one project.
//
// Pure and DOM-free on purpose: this is the highest-risk code in the sync
// path. Getting it wrong destroys someone's work quietly, so every rule here
// is exercised by merge.test.js against plain fixtures, with no browser, no
// server and no store involved.
//
// The merge splits by data shape, which is what makes it tractable without a
// CRDT:
//
//   - scripts are line-oriented text, so a line-level diff3 gives real git
//     semantics: regions only one side touched merge silently, regions both
//     sides touched differently become conflicts a human resolves
//   - boards, research, links and comments are id-keyed records, so they
//     merge as sets: adds union, an untouched record deleted on one side is
//     deleted, and a record edited differently on both sides is a conflict
//   - anchors are deliberately not merged at all. resolve.js re-searches
//     quoted text rather than trusting offsets, so a link finds its passage
//     again after a merged edit for the same reason it survives a local one
//   - project meta (name, workspace, type, target, layout, contributors)
//     merges field-wise and never conflicts: when both sides changed the same
//     field, mine wins. A modal conflict over a project name is
//     disproportionate to a field the settings card can change back in one
//     keystroke.
//
// `base` is the last version this device successfully synced. When it is
// missing (the page was reloaded and the in-memory snapshot lost), the merge
// degrades honestly to a two-way merge: common text regions still merge, and
// everything that genuinely differs becomes a conflict rather than a guess.
'use strict';

const RECORD_COLLECTIONS = ['boards', 'research', 'folders', 'links', 'comments'];
const META_FIELDS = ['name', 'workspace', 'type', 'targetMins', 'layout', 'contributors'];

function jsonEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- line diff ----

// Matching line pairs [ia, ib] between two line arrays, via LCS. Common
// prefix/suffix are peeled off first so the quadratic middle stays small for
// the ordinary case of a script edited in a few places.
function lcsMatches(a, b) {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ahi = a.length, bhi = b.length;
  while (ahi > lo && bhi > lo && a[ahi - 1] === b[bhi - 1]) { ahi--; bhi--; }

  const n = ahi - lo, m = bhi - lo;
  const matches = [];
  for (let k = 0; k < lo; k++) matches.push([k, k]);

  if (n > 0 && m > 0) {
    // Classic DP table over the trimmed middle. Uint32Array keeps it compact;
    // a merge runs once per conflict, not per keystroke, so quadratic here is
    // acceptable and predictable.
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = a[lo + i] === b[lo + j]
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[lo + i] === b[lo + j]) { matches.push([lo + i, lo + j]); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
      else j++;
    }
  }

  for (let k = 0; k < a.length - ahi; k++) matches.push([ahi + k, bhi + k]);
  return matches;
}

// ---- text diff3 ----

// Merge one script's text. Returns {clean, text} when everything merged, or
// {clean:false, segments} where segments alternate:
//   {type:'text', lines}
//   {type:'conflict', base, mine, theirs}
// and the final text is rebuilt from resolutions by resolveSegments().
export function mergeText(baseText, mineText, theirsText) {
  const m = String(mineText).split('\n');
  const t = String(theirsText).split('\n');

  // No base: two-way merge. Lines common to both sides are stable, every gap
  // between them is a conflict. Nothing is guessed.
  if (baseText == null) return twoWay(m, t);

  const b = String(baseText).split('\n');
  const bm = new Map(lcsMatches(b, m));
  const bt = new Map(lcsMatches(b, t));

  const segments = [];
  const flushChunk = (bs, be, ms, me, ts, te) => {
    const bc = b.slice(bs, be), mc = m.slice(ms, me), tc = t.slice(ts, te);
    const mSame = jsonEqual(bc, mc), tSame = jsonEqual(bc, tc);
    if (mSame && tSame) { pushText(segments, bc); return; }
    if (mSame) { pushText(segments, tc); return; }
    if (tSame) { pushText(segments, mc); return; }
    if (jsonEqual(mc, tc)) { pushText(segments, mc); return; }
    segments.push({ type: 'conflict', base: bc, mine: mc, theirs: tc });
  };

  let bi = 0, mi = 0, ti = 0;
  for (let i = 0; i <= b.length; i++) {
    // A stable point is a base line matched in BOTH sides. The walk emits the
    // chunk accumulated since the previous stable point, then the stable line
    // itself. i === b.length is the closing sentinel that flushes the tail.
    const mj = bm.get(i), tj = bt.get(i);
    const stable = i < b.length && mj != null && tj != null;
    if (!stable && i < b.length) continue;
    const mEnd = i < b.length ? mj : m.length;
    const tEnd = i < b.length ? tj : t.length;
    flushChunk(bi, i, mi, mEnd, ti, tEnd);
    if (i < b.length) {
      pushText(segments, [b[i]]);
      bi = i + 1; mi = mj + 1; ti = tj + 1;
    }
  }

  return finishText(segments);
}

function twoWay(m, t) {
  const mt = lcsMatches(m, t);
  const segments = [];
  let mi = 0, ti = 0;
  for (const [i, j] of [...mt, [m.length, t.length]]) {
    const mc = m.slice(mi, i), tc = t.slice(ti, j);
    if (mc.length || tc.length) {
      if (jsonEqual(mc, tc)) pushText(segments, mc);
      else segments.push({ type: 'conflict', base: null, mine: mc, theirs: tc });
    }
    if (i < m.length) pushText(segments, [m[i]]);
    mi = i + 1; ti = j + 1;
  }
  return finishText(segments);
}

function pushText(segments, lines) {
  if (!lines.length) return;
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') last.lines.push(...lines);
  else segments.push({ type: 'text', lines: lines.slice() });
}

function finishText(segments) {
  const clean = segments.every((s) => s.type === 'text');
  if (clean) return { clean: true, text: segments.map((s) => s.lines.join('\n')).join('\n') };
  return { clean: false, segments };
}

// Rebuild a script's text from its segments and the per-conflict resolutions
// ('mine' | 'theirs' | 'both'). 'both' keeps mine's lines then theirs', which
// is what "keep both" can only mean for text.
export function resolveSegments(segments, resolutions) {
  const out = [];
  let ci = 0;
  for (const seg of segments) {
    if (seg.type === 'text') { out.push(...seg.lines); continue; }
    const r = resolutions[ci++];
    if (r === 'theirs') out.push(...seg.theirs);
    else if (r === 'both') { out.push(...seg.mine, ...seg.theirs); }
    else out.push(...seg.mine);
  }
  return out.join('\n');
}

// ---- record collections ----

function byId(arr) { return new Map((arr || []).map((r) => [r.id, r])); }

// Set merge for one id-keyed collection. Mutates nothing; pushes conflict
// hunks into `hunks` and returns the merged array with conflicts provisionally
// resolved as 'mine' (commitMerge re-applies real resolutions).
function mergeCollection(name, base, mine, theirs, hunks) {
  const B = byId(base), M = byId(mine), T = byId(theirs);
  const out = [];
  const seen = new Set();

  const consider = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = B.get(id), m = M.get(id), t = T.get(id);

    if (m && !t) {
      // Absent on their side. With a base, absence there means they deleted
      // it: apply the delete unless I edited it, which is a real conflict.
      // Without a base, absence is indistinguishable from "I added it", so
      // keeping it is the only non-destructive reading.
      if (!b) { out.push(m); return; }
      if (jsonEqual(b, m)) return; // they deleted, I did not touch it
      hunks.push({ kind: 'record', collection: name, id, base: b, mine: m, theirs: null, resolution: null });
      out.push(m);
      return;
    }
    if (t && !m) {
      if (!b) { out.push(t); return; }
      if (jsonEqual(b, t)) return; // I deleted, they did not touch it
      hunks.push({ kind: 'record', collection: name, id, base: b, mine: null, theirs: t, resolution: null });
      return; // provisional 'mine' = stay deleted
    }
    if (!m && !t) return;

    if (jsonEqual(m, t)) { out.push(m); return; }
    if (b && jsonEqual(b, m)) { out.push(t); return; }
    if (b && jsonEqual(b, t)) { out.push(m); return; }
    hunks.push({ kind: 'record', collection: name, id, base: b || null, mine: m, theirs: t, resolution: null });
    out.push(m);
  };

  // Mine's order first so the merged array stays stable for this device, then
  // records only the other side has, in their order.
  for (const r of mine || []) consider(r.id);
  for (const r of theirs || []) consider(r.id);
  return out;
}

// ---- hard rule 4 ----

// Exactly one final draft after a merge, whatever the two sides did. Each side
// can legitimately have promoted a different draft; the committed project has
// to settle it, and it settles in favor of MINE's choice because that is the
// draft the person doing the merging was just working against. The other
// side's promotion is not lost silently: their draft is still present, just
// demoted, and the merge dialog showed the divergence.
export function enforceSingleFinal(project, mineFinalId) {
  const scripts = project.scripts || [];
  if (!scripts.length) return project;
  const finals = scripts.filter((s) => s.final);
  if (finals.length === 1) return project;
  const keep = (mineFinalId && scripts.find((s) => s.id === mineFinalId && s.final)) || finals[0] || scripts[0];
  return {
    ...project,
    scripts: scripts.map((s) => (s.id === keep.id ? { ...s, final: true } : s.final ? { ...s, final: false } : s)),
  };
}

// ---- the whole project ----

// mergeProjects(base, mine, theirs) -> { project, hunks, textSegments, clean }
//
//   project       the merged tree, with every conflict provisionally resolved
//                 as 'mine' (never persisted in this state: the caller either
//                 gets clean === true or holds it in transient ui until
//                 commitMergedProject applies real resolutions)
//   hunks         [{kind:'script', scriptId, scriptName, segIndex, base, mine,
//                   theirs, resolution}] and
//                 [{kind:'record', collection, id, base, mine, theirs,
//                   resolution}]
//   textSegments  { scriptId: segments } for scripts that had text conflicts
//
// `base` may be null (lost snapshot); see mergeText's two-way fallback.
export function mergeProjects(base, mine, theirs) {
  const hunks = [];
  const textSegments = {};
  const b = base || null;

  // Meta: field-wise, mine wins ties. See the header for why this never
  // produces a hunk.
  const merged = { ...mine };
  for (const f of META_FIELDS) {
    if (b && jsonEqual(b[f], mine[f]) && !jsonEqual(b[f], theirs[f])) merged[f] = theirs[f];
  }

  // Scripts: id-keyed like the other collections, but the text field gets a
  // real diff3 instead of whole-record comparison, because "we both edited
  // the script" is the normal case, not the conflict case.
  const B = byId(b ? b.scripts : []), M = byId(mine.scripts), T = byId(theirs.scripts);
  const scripts = [];
  const seen = new Set();
  const considerScript = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const sb = B.get(id), sm = M.get(id), st = T.get(id);
    if (sm && !st) {
      if (!sb || !jsonEqual(sb, sm)) scripts.push(sm);
      return;
    }
    if (st && !sm) {
      if (!sb || !jsonEqual(sb, st)) scripts.push(st);
      return;
    }
    if (!sm && !st) return;

    // Record fields other than text merge field-wise (name, final). `final`
    // divergence is settled by enforceSingleFinal at the end.
    const rec = { ...sm };
    if (sb && sm.name === sb.name && st.name !== sb.name) rec.name = st.name;
    if (sb && sm.final === sb.final && st.final !== sb.final) rec.final = st.final;

    if (sm.text !== st.text) {
      const r = mergeText(sb ? sb.text : null, sm.text, st.text);
      if (r.clean) rec.text = r.text;
      else {
        textSegments[id] = r.segments;
        r.segments.forEach((seg, segIndex) => {
          if (seg.type !== 'conflict') return;
          hunks.push({
            kind: 'script', scriptId: id, scriptName: sm.name, segIndex,
            base: seg.base, mine: seg.mine, theirs: seg.theirs, resolution: null,
          });
        });
        // Provisional text: every conflict as 'mine'.
        rec.text = resolveSegments(r.segments, r.segments.filter((s) => s.type === 'conflict').map(() => 'mine'));
      }
    }
    scripts.push(rec);
  };
  for (const s of mine.scripts || []) considerScript(s.id);
  for (const s of theirs.scripts || []) considerScript(s.id);
  merged.scripts = scripts;

  for (const name of RECORD_COLLECTIONS) {
    merged[name] = mergeCollection(name, b ? b[name] : null, mine[name], theirs[name], hunks);
  }

  const mineFinal = (mine.scripts || []).find((s) => s.final);
  const project = enforceSingleFinal(merged, mineFinal && mineFinal.id);
  return { project, hunks, textSegments, clean: hunks.length === 0 };
}

// Apply the user's resolutions to a mergeProjects result and return the final
// project. Refuses (returns null) while any hunk is unresolved: the dialog
// must not be dismissible into a silent choice.
export function commitMergedProject(result) {
  const { project, hunks, textSegments } = result;
  if (hunks.some((h) => !h.resolution)) return null;

  let next = { ...project };

  // Script texts: rebuild each conflicted script from its segments in
  // document order (hunks were pushed in segment order per script).
  const byScript = {};
  for (const h of hunks) {
    if (h.kind !== 'script') continue;
    (byScript[h.scriptId] = byScript[h.scriptId] || []).push(h);
  }
  if (Object.keys(byScript).length) {
    next.scripts = next.scripts.map((s) => {
      const hs = byScript[s.id];
      if (!hs) return s;
      return { ...s, text: resolveSegments(textSegments[s.id], hs.map((h) => h.resolution)) };
    });
  }

  // Records: 'theirs' swaps their version in (or deletes, when theirs is the
  // deletion); 'mine' keeps the provisional state, which already is mine.
  for (const h of hunks) {
    if (h.kind !== 'record' || h.resolution !== 'theirs') continue;
    const arr = next[h.collection] || [];
    if (h.theirs === null) next = { ...next, [h.collection]: arr.filter((r) => r.id !== h.id) };
    else if (arr.some((r) => r.id === h.id)) next = { ...next, [h.collection]: arr.map((r) => (r.id === h.id ? h.theirs : r)) };
    else next = { ...next, [h.collection]: [...arr, h.theirs] };
  }

  const mineFinal = (project.scripts || []).find((s) => s.final);
  return enforceSingleFinal(next, mineFinal && mineFinal.id);
}

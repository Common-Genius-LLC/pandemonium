// The research SOURCE: one record, not three kinds of record.
//
// The panel used to offer "+ Note" and "+ Link" as two top-level buttons, and
// dropping a file made a third, invisible kind. They were never three things:
// the stored record has always been {title, url, body, attachment}, and a
// "link" was just one with a url and no body while a "note" was one with a
// body and no url. Nothing stopped a record having both, and nothing showed
// it if it did. So `kind` is derived here from what a source actually holds
// rather than chosen up front, and every source can carry all three: a piece
// of media, a URL it came from, and notes about it.
//
// Bodies are free text, not Fountain: paragraphs split on a blank line, each
// rendered and resolved the way a script block is (reusing blockHTML +
// resolvePart with a one-run "block"), just without any of the scene/dialogue
// typing. That is what makes a passage inside a source linkable to a passage
// in the script, and it applies to the notes under a piece of media too, so
// an image is no longer a dead end.
'use strict';

export function docParas(doc) {
  return String(doc.body || '').split(/\n{2,}/).map((s) => s.replace(/^\n+|\n+$/g, ''));
}

export function paraAsBlock(text) {
  return { plain: text, runs: [{ t: text, b: false, i: false, u: false, n: false }] };
}

// ---- editing the notes as paragraphs ----
//
// The reader edits a source's notes one paragraph at a time, in place, so the
// three things that can happen to the paragraph list (a retype, a split at the
// caret, a merge into the one above) live here as pure functions rather than
// as DOM code. Each returns the whole new list plus where the caret belongs
// afterwards, because "which paragraph, how far in" is the part the reader
// cannot recompute once the list has changed under it.
//
// `text` is passed in rather than read from `paras[pi]`: the paragraph being
// edited holds what the writer has typed since the last commit, which is
// exactly what has not reached the stored body yet.

export function parasToBody(paras) {
  return paras.join('\n\n');
}

export function setPara(paras, pi, text) {
  const next = paras.slice();
  next[pi] = text;
  return next;
}

export function splitPara(paras, pi, text, offset) {
  const at = Math.max(0, Math.min(offset, text.length));
  const next = paras.slice();
  next.splice(pi, 1, text.slice(0, at), text.slice(at));
  return { paras: next, caret: { pi: pi + 1, offset: 0 } };
}

// Folds a paragraph into the one above it, caret left at the join. Refused for
// the first paragraph, which has nothing to fold into.
export function mergePara(paras, pi, text) {
  if (pi <= 0) return null;
  const prev = paras[pi - 1] || '';
  const next = paras.slice();
  next.splice(pi - 1, 2, prev + text);
  return { paras: next, caret: { pi: pi - 1, offset: prev.length } };
}

// What a source IS, read off what it holds. Media wins (a file with notes is
// still a file), then a bare URL, then notes. Stored on the record by
// addResearch/updateResearch so cards, search and sync can read it without
// recomputing, but this is the one definition of it.
export function researchKind(doc) {
  if (!doc) return 'note';
  if (doc.attachment && (doc.attachment.data || doc.attachment.assetId)) return 'file';
  if ((doc.url || '').trim() && !(doc.body || '').trim()) return 'link';
  return 'note';
}

// Which viewer an attachment needs. Everything that is not one of the four we
// can show inline is 'file': offered as a download rather than rendered badly.
export function mediaKind(attachment) {
  const mime = (attachment && attachment.mime) || '';
  if (/^image\//.test(mime)) return 'image';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

// The six source colours (see tokens.css). `plain` is the absence of a colour
// and is stored as null, so an uncoloured source keeps the panel's own card
// fill and nothing has to migrate.
// Each colour is two values, not one: `token` is the card's fill, a large
// quiet surface, and `dot` is the same colour as an 18px swatch, which has to
// be saturated enough to tell apart at that size. One value cannot do both.
export const NOTE_COLORS = [
  { key: null, label: 'Plain', token: 'var(--note-plain)', dot: 'var(--note-plain-dot)' },
  { key: 'yellow', label: 'Yellow', token: 'var(--note-yellow)', dot: 'var(--note-yellow-dot)' },
  { key: 'green', label: 'Green', token: 'var(--note-green)', dot: 'var(--note-green-dot)' },
  { key: 'pink', label: 'Pink', token: 'var(--note-pink)', dot: 'var(--note-pink-dot)' },
  { key: 'blue', label: 'Blue', token: 'var(--note-blue)', dot: 'var(--note-blue-dot)' },
  { key: 'orange', label: 'Orange', token: 'var(--note-orange)', dot: 'var(--note-orange-dot)' },
];

function colorEntry(key) {
  return NOTE_COLORS.find((c) => c.key === (key || null)) || NOTE_COLORS[0];
}

export function colorToken(key) { return colorEntry(key).token; }
export function colorDot(key) { return colorEntry(key).dot; }

// A pasted or dropped URL rarely arrives with a scheme. Without one the
// browser resolves it against the app's own origin, which is how "wikipedia.org"
// became a dead in-app link. Returns '' for anything that is not a URL at all,
// so callers can tell "this text is a link" from "this text is a note".
export function normalizeUrl(text) {
  const raw = String(text || '').trim();
  if (!raw || /\s/.test(raw)) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// A source's title when it has none of its own: the file name for a piece of
// media, the page's own title for a link the server has read, its host for
// one it has not, the first words of the notes otherwise.
export function docTitle(doc) {
  const given = (doc.title || '').trim();
  if (given && given !== 'Untitled') return given;
  if (doc.attachment && doc.attachment.name) return doc.attachment.name;
  if (doc.preview && doc.preview.title && doc.preview.url === doc.url) return doc.preview.title;
  const host = hostOf(doc.url || '');
  if (host) return host;
  const first = (doc.body || '').trim().split('\n')[0];
  return first ? first.slice(0, 60) : 'Untitled';
}

// The card's preview line: the notes if there are any, else what the source
// points at, so a card is never blank.
export function docSnippet(doc) {
  const body = (doc.body || '').trim();
  if (body) return body.slice(0, 180);
  const p = doc.preview && doc.preview.url === doc.url ? doc.preview : null;
  if (p && p.description) return p.description.slice(0, 180);
  if ((doc.url || '').trim()) return doc.url;
  if (doc.attachment && doc.attachment.mime) return doc.attachment.mime;
  return '';
}

// ---- labels ----
//
// Labels group sources into topics (costume, the 1974 fire, Rothko). They are
// free text and the set of them is DERIVED from what is in use: there is no
// label manager, no place to define one before using it, and no way to end up
// with a list of labels nothing carries. Typing a new one creates it, removing
// the last use of one retires it.
//
// Labels are deliberately not coloured. A source already has a colour of its
// own, and two colour systems on one card would be two things to keep straight
// where the point is to have fewer.

export const MAX_LABEL = 32;

// Collapses whitespace and trims, so "  the  fire " and "the fire" are one
// label rather than two that look identical in the grid.
export function normalizeLabel(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

function sameLabel(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// Case-insensitively deduped, because "Costume" and "costume" are one topic;
// the spelling that was used first is the one kept.
export function addLabel(labels, text) {
  const label = normalizeLabel(text);
  const list = labels || [];
  if (!label || list.some((l) => sameLabel(l, label))) return list;
  return [...list, label];
}

export function removeLabel(labels, text) {
  const label = normalizeLabel(text);
  return (labels || []).filter((l) => !sameLabel(l, label));
}

// Every label in use, with how many sources carry it, most used first and
// alphabetical within that. This is the whole of the label list: it cannot
// drift from what the sources actually say, because it is read off them.
export function allLabels(research) {
  const counts = new Map();
  for (const d of research || []) {
    for (const raw of d.labels || []) {
      const label = normalizeLabel(raw);
      if (!label) continue;
      const key = label.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function hasLabel(doc, text) {
  const label = normalizeLabel(text);
  return (doc.labels || []).some((l) => sameLabel(l, label));
}

// ---- folders ----
//
// References can be filed in folders, nested as deep as the writer likes, and a
// folder carries labels exactly as a reference does (so a topic can be a
// folder, a label, or both). A reference or folder whose parent has gone (a
// merge that deleted the folder on the other side) reads as top level rather
// than vanishing: nothing here trusts a folderId to still point somewhere.

const inFolder = (item, key, ids) => (item[key] && ids.has(item[key]) ? item[key] : null);

// Root to `id`, as folder records. Stops at a cycle rather than looping.
export function folderPath(folders, id) {
  const byId = new Map((folders || []).map((f) => [f.id, f]));
  const out = [];
  const seen = new Set();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return out;
}

export function isInsideFolder(folders, id, ancestorId) {
  return folderPath(folders, id).some((f) => f.id === ancestorId);
}

// A folder may move to the top level or into any folder that is not itself or
// one of its own descendants (which would cut it off from the tree).
export function canMoveFolder(folders, id, parentId) {
  const list = folders || [];
  if (!list.some((f) => f.id === id)) return false;
  if (parentId == null) return true;
  if (parentId === id || !list.some((f) => f.id === parentId)) return false;
  return !isInsideFolder(list, parentId, id);
}

// Where something can be moved: the top level, then every folder as its full
// path, alphabetical, leaving out `exclude` and everything inside it.
export function moveTargets(folders, exclude = null) {
  const list = folders || [];
  const out = list
    .filter((f) => !exclude || !isInsideFolder(list, f.id, exclude))
    .map((f) => ({ id: f.id, label: folderPath(list, f.id).map((x) => x.name || 'Untitled').join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ id: null, label: 'References (top level)' }, ...out];
}

// How many things a folder holds directly.
export function folderCount(research, folders, id) {
  const ids = new Set((folders || []).map((f) => f.id));
  return (research || []).filter((d) => inFolder(d, 'folderId', ids) === id).length
    + (folders || []).filter((f) => inFolder(f, 'parentId', ids) === id).length;
}

// What the grid shows. Normally that is one folder's contents. As soon as the
// writer searches, picks a topic or asks for the unlinked ones, it is every
// match across all folders at once ("flat"): a search that only looked in the
// folder you happen to be standing in would find nothing and say so wrongly.
export function browse({ research, folders, folderId = null, query = '', labels = null, unlinkedOnly = false, linked = null, ids = null }) {
  const folderIds = new Set((folders || []).map((f) => f.id));
  const here = folderId && folderIds.has(folderId) ? folderId : null;
  const q = String(query || '').trim().toLowerCase();
  const want = labels && labels.size ? [...labels].map((l) => l.toLowerCase()) : null;
  const flat = !!q || !!want || !!unlinkedOnly || !!ids;

  let docs = filterResearch(research, { query, unlinkedOnly, linked, labels, ids });
  if (!flat) docs = docs.filter((d) => inFolder(d, 'folderId', folderIds) === here);

  let subs;
  if (!flat) {
    subs = (folders || []).filter((f) => inFolder(f, 'parentId', folderIds) === here);
  } else if (unlinkedOnly || ids) {
    subs = []; // a folder is not "unlinked" or linked in a draft; those filters are about references
  } else {
    subs = (folders || []).filter((f) => {
      if (want && !(f.labels || []).some((l) => want.includes(normalizeLabel(l).toLowerCase()))) return false;
      if (!q) return true;
      return [f.name, ...(f.labels || [])].filter(Boolean).join('\n').toLowerCase().includes(q);
    });
  }
  subs = subs.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { flat, folders: subs, docs: docs.slice().reverse(), here };
}

// The grid's filter. Pure so the panel stays a renderer: `linked` is the set of
// research ids that currently have at least one link to the script, which only
// the store can know. Matching is over everything a source holds (title, notes,
// URL, file name), since a writer searching "baddeley" does not know or care
// which field they put it in.
export function filterResearch(research, { query = '', unlinkedOnly = false, linked = null, labels = null, ids = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  // Several chosen labels widen rather than narrow: picking Costume and Fire
  // asks for both topics, which is what clicking two chips in a row of topics
  // is taken to mean. Narrowing is what the search box is for.
  const want = labels && labels.size ? [...labels].map((l) => l.toLowerCase()) : null;
  return (research || []).filter((d) => {
    if (ids && !ids.has(d.id)) return false; // only these (the ones a draft links to)
    if (unlinkedOnly && linked && linked.has(d.id)) return false;
    if (want && !(d.labels || []).some((l) => want.includes(normalizeLabel(l).toLowerCase()))) return false;
    if (!q) return true;
    const hay = [d.title, d.body, d.url, d.attachment && d.attachment.name, ...(d.labels || []),
      d.preview && d.preview.title, d.preview && d.preview.description]
      .filter(Boolean).join('\n').toLowerCase();
    return hay.includes(q);
  });
}

// The remote persistence adapter: the third implementation behind db.js, next
// to local-db.js and local-file-adapter.js. Talks to the Bun/Hono backend over
// the same project shape the local adapters use, so nothing above db.js changes.
// Phase A document sync: a whole project tree is one row on the server.
'use strict';

import { session } from './session.js';
import { downscaleDataURL } from '../utils/files.js';

async function asJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

const assetIdByDataUrl = new Map();
const dataUrlByAssetId = new Map();

function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

async function uploadAsset(dataUrl, originalName = '') {
  const cached = assetIdByDataUrl.get(dataUrl);
  if (cached) return cached;
  const compressed = await downscaleDataURL(dataUrl);
  const out = await asJson(await session.apiFetch('/assets', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: compressed, originalName }),
  }));
  assetIdByDataUrl.set(dataUrl, out.id);
  dataUrlByAssetId.set(out.id, compressed);
  return out.id;
}

async function loadAssetDataUrl(assetId) {
  const cached = dataUrlByAssetId.get(assetId);
  if (cached) return cached;
  const out = await asJson(await session.apiFetch(`/assets/${assetId}`));
  dataUrlByAssetId.set(assetId, out.dataUrl);
  assetIdByDataUrl.set(out.dataUrl, assetId);
  return out.dataUrl;
}

async function hydrateProject(project) {
  const boards = await Promise.all((project.boards || []).map(async (b) => {
    if (isDataUrl(b.img) || !b.imgAssetId) return b;
    const img = await loadAssetDataUrl(b.imgAssetId);
    const next = { ...b, img };
    delete next.imgAssetId;
    return next;
  }));

  const research = await Promise.all((project.research || []).map(async (d) => {
    const att = d.attachment;
    if (!att || isDataUrl(att.data) || !att.assetId) return d;
    const data = await loadAssetDataUrl(att.assetId);
    const next = { ...d, attachment: { ...att, data } };
    delete next.attachment.assetId;
    return next;
  }));

  return { ...project, boards, research };
}

async function prepareProjectForRemote(project) {
  const boards = await Promise.all((project.boards || []).map(async (b) => {
    if (!isDataUrl(b.img)) return b;
    const assetId = await uploadAsset(b.img, `${b.id || 'board'}.png`);
    const next = { ...b, imgAssetId: assetId };
    delete next.img;
    return next;
  }));

  const research = await Promise.all((project.research || []).map(async (d) => {
    const att = d.attachment;
    if (!att || !isDataUrl(att.data)) return d;
    const assetId = await uploadAsset(att.data, att.name || `${d.id || 'attachment'}.bin`);
    const next = { ...d, attachment: { ...att, assetId } };
    delete next.attachment.data;
    return next;
  }));

  return { ...project, boards, research };
}

export async function listProjectsRemote() {
  return asJson(await session.apiFetch('/projects'));
}

// Loads a project and adopts it as the currently open remote project (records
// its id, concurrency token, and the content snapshot future merges will use
// as their common ancestor).
export async function loadProjectRemote(id) {
  const out = await asJson(await session.apiFetch(`/projects/${id}`));
  session.setCurrentRemoteId(out.id);
  session.setBase(out.updatedAt);
  const project = await hydrateProject(out.project);
  session.setBaseSnapshot(project);
  return project;
}

export async function deleteProjectRemote(id) {
  const res = await session.apiFetch(`/projects/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status}).`);
  if (session.getCurrentRemoteId() === id) {
    session.setCurrentRemoteId(null);
    session.setBase(null);
  }
}

// Serialize writes. Autosave is debounced upstream, but the very first change to
// a brand-new project can still fire two saves before the create round-trips;
// chaining them means the second sees the id the first assigned, so we never
// create two rows for one project or apply writes out of order.
let chain = Promise.resolve();

export function saveProjectRemote(project) {
  chain = chain.then(() => doSave(project), () => doSave(project));
  return chain;
}

// Where a 409 goes. Set once by app-root (setConflictHandler below); kept as an
// injected function so this adapter never imports a component or the store.
// Receives {base, mine, theirs, theirUpdatedAt}: everything a three-way merge
// needs, with `theirs` already hydrated back to client shape so the three
// trees compare like for like.
let onConflict = null;
export function setConflictHandler(fn) { onConflict = fn; }

// After the user (or a clean automatic merge) has produced the reconciled
// project: adopt the server timestamp the conflict reported and save. Riding
// the same chain as every other save keeps merge commits ordered with
// ordinary autosaves.
export function saveMergedRemote(project, theirUpdatedAt) {
  session.setBase(theirUpdatedAt);
  return saveProjectRemote(project);
}

async function doSave(project) {
  const id = session.getCurrentRemoteId();
  const remoteProject = await prepareProjectForRemote(project);
  if (!id) {
    const out = await asJson(await session.apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ project: remoteProject }),
    }));
    session.setCurrentRemoteId(out.id);
    session.setBase(out.updatedAt);
    session.setBaseSnapshot(project);
    return out;
  }

  const res = await session.apiFetch(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ project: remoteProject, baseUpdatedAt: session.getBase() }),
  });

  if (res.status === 409) {
    // Another writer landed in between. This used to retry with the server's
    // timestamp, which is last-write-wins: defensible for one person on two
    // devices, and silent data loss the moment a collaborator can write. The
    // 409 body carries the full server copy, session holds the snapshot this
    // device last synced, and `project` is what we tried to write: exactly
    // base, theirs and mine for a three-way merge. Hand them over and write
    // nothing; the merge flow owns the next save (saveMergedRemote).
    const conflict = await res.json().catch(() => ({}));
    const current = conflict.current;
    if (!current || !current.project || !onConflict) {
      throw new Error('The project changed on the server and could not be reconciled.');
    }
    const theirs = await hydrateProject(current.project);
    onConflict({
      base: session.getBaseSnapshot(),
      mine: project,
      theirs,
      theirUpdatedAt: current.updatedAt,
    });
    return null;
  }

  const out = await asJson(res);
  session.setBase(out.updatedAt);
  session.setBaseSnapshot(project);
  return out;
}

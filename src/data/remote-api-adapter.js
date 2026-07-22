// The remote persistence adapter: the third implementation behind db.js, next
// to local-db.js and local-file-adapter.js. Talks to the Bun/Hono backend over
// the same project shape the local adapters use, so nothing above db.js changes.
// Phase A document sync: a whole project tree is one row on the server.
'use strict';

import { session } from './session.js';

async function asJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export async function listProjectsRemote() {
  return asJson(await session.apiFetch('/projects'));
}

// Loads a project and adopts it as the currently open remote project (records
// its id and concurrency token so subsequent autosaves update it in place).
export async function loadProjectRemote(id) {
  const out = await asJson(await session.apiFetch(`/projects/${id}`));
  session.setCurrentRemoteId(out.id);
  session.setBase(out.updatedAt);
  return out.project;
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

async function doSave(project) {
  const id = session.getCurrentRemoteId();
  if (!id) {
    const out = await asJson(await session.apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ project }),
    }));
    session.setCurrentRemoteId(out.id);
    session.setBase(out.updatedAt);
    return out;
  }

  const put = (base) => session.apiFetch(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ project, baseUpdatedAt: base }),
  });

  let res = await put(session.getBase());
  if (res.status === 409) {
    // Another device wrote in between. For single-user multi-device sync the
    // safe-and-simple resolution is last-write-wins: adopt the server's current
    // timestamp and retry once so this device's latest state lands.
    const conflict = await res.json().catch(() => ({}));
    const serverTs = conflict.current && conflict.current.updatedAt;
    res = await put(serverTs);
  }
  const out = await asJson(res);
  session.setBase(out.updatedAt);
  return out;
}

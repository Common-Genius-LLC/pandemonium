// Sharing sits behind the same seam as every other persistence concern:
// components call db.js, db.js re-exports these. Phase A stores a project as
// one document, so every grant is project-scoped; a share dialog that offered
// per-script access would be describing an isolation the storage cannot
// provide, and that is a promise, not a UI detail.
'use strict';

import { session } from './session.js';

async function asJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// ---- collaborator grants ----

export async function listShares(projectId) {
  return asJson(await session.apiFetch(`/projects/${projectId}/shares`));
}

export async function addShare(projectId, email, role) {
  return asJson(await session.apiFetch(`/projects/${projectId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  }));
}

export async function removeShare(projectId, shareId) {
  const res = await session.apiFetch(`/projects/${projectId}/shares/${shareId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Could not remove that person (${res.status}).`);
}

// ---- read-only link ----

export async function getReadLink(projectId) {
  return asJson(await session.apiFetch(`/projects/${projectId}/share-link`));
}

export async function createReadLink(projectId) {
  return asJson(await session.apiFetch(`/projects/${projectId}/share-link`, { method: 'POST' }));
}

export async function revokeReadLink(projectId) {
  const res = await session.apiFetch(`/projects/${projectId}/share-link`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Could not revoke the link (${res.status}).`);
}

// The viewer side of a read link. Deliberately a plain fetch, not
// session.apiFetch: the person opening a shared link has no account and no
// token, and the whole point of the route is that the link itself is the
// capability.
export async function fetchSharedProjection(token) {
  const res = await fetch(session.apiBase + '/shared/' + encodeURIComponent(token));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That link is not valid.');
  return data.project;
}

// The URL a recipient actually opens: this app, with the token as a query
// parameter the boot path recognizes (see pandemonium-app #bootSharedView).
export function readLinkUrl(token) {
  return location.origin + location.pathname + '?share=' + encodeURIComponent(token);
}

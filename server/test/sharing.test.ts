// Sharing and role smoke tests, same harness as smoke.test.ts: the real app
// over in-memory SQLite. These pin the access rules the client now depends
// on: what a viewer can and cannot do, what an editor can, what only an owner
// can, and what a read link serves to someone with no account at all.

import { describe, it, expect, beforeAll } from 'bun:test';

process.env.DATABASE_URL = 'sqlite://:memory:';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789';

const { default: app } = await import('../src/app');
const { migrate } = await import('../src/db');

const json = (path: string, method: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const sampleProject = {
  name: 'Shared Picture',
  workspace: 'Common Genius',
  scripts: [{ id: 's1', name: 'Final Draft', text: 'INT. ROOM - DAY\n\nAction.\n', final: true }],
  boards: [], research: [], links: [], comments: [],
};

async function register(email: string) {
  const res = await json('/v1/auth/register', 'POST', { email, password: 'supersecret' });
  expect(res.status).toBe(201);
  return (await res.json()).accessToken as string;
}

let owner = '', editor = '', viewer = '', stranger = '';
let projectId = '', updatedAt = '';

beforeAll(async () => {
  await migrate();
  owner = await register('owner@example.com');
  editor = await register('editor@example.com');
  viewer = await register('viewer@example.com');
  stranger = await register('stranger@example.com');
  const created = await json('/v1/projects', 'POST', { project: sampleProject }, owner);
  expect(created.status).toBe(201);
  const out = await created.json();
  projectId = out.id;
  updatedAt = out.updatedAt;
});

describe('collaborator grants', () => {
  it('rejects sharing with an email that has no account', async () => {
    const res = await json(`/v1/projects/${projectId}/shares`, 'POST', { email: 'nobody@example.com', role: 'viewer' }, owner);
    expect(res.status).toBe(404);
  });

  it('rejects sharing with yourself and rejects unknown roles', async () => {
    expect((await json(`/v1/projects/${projectId}/shares`, 'POST', { email: 'owner@example.com', role: 'viewer' }, owner)).status).toBe(400);
    expect((await json(`/v1/projects/${projectId}/shares`, 'POST', { email: 'editor@example.com', role: 'admin' }, owner)).status).toBe(400);
  });

  it('grants editor and viewer roles', async () => {
    expect((await json(`/v1/projects/${projectId}/shares`, 'POST', { email: 'editor@example.com', role: 'editor' }, owner)).status).toBe(201);
    expect((await json(`/v1/projects/${projectId}/shares`, 'POST', { email: 'viewer@example.com', role: 'viewer' }, owner)).status).toBe(201);
    const list = await (await json(`/v1/projects/${projectId}/shares`, 'GET', undefined, owner)).json();
    expect(list.map((s: any) => s.role).sort()).toEqual(['editor', 'viewer']);
  });

  it('only the owner manages shares', async () => {
    const res = await json(`/v1/projects/${projectId}/shares`, 'GET', undefined, editor);
    expect(res.status).toBe(404);
  });

  it('shared projects appear in the grantee list, labeled with the role', async () => {
    const list = await (await json('/v1/projects', 'GET', undefined, editor)).json();
    const row = list.find((p: any) => p.id === projectId);
    expect(row).toBeTruthy();
    expect(row.role).toBe('editor');
    expect(row.workspace).toBe('Common Genius');
  });

  it('a stranger still sees nothing (404, not 403, so existence leaks nothing)', async () => {
    const res = await json(`/v1/projects/${projectId}`, 'GET', undefined, stranger);
    expect(res.status).toBe(404);
  });

  it('an editor can write, a viewer cannot', async () => {
    const get = await (await json(`/v1/projects/${projectId}`, 'GET', undefined, editor)).json();
    const asEditor = await json(`/v1/projects/${projectId}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: get.updatedAt,
    }, editor);
    expect(asEditor.status).toBe(200);
    updatedAt = (await asEditor.json()).updatedAt;

    const asViewer = await json(`/v1/projects/${projectId}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: updatedAt,
    }, viewer);
    expect(asViewer.status).toBe(403);
  });

  it('a 409 carries the full current project (the merge depends on this)', async () => {
    const res = await json(`/v1/projects/${projectId}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: '1999-01-01T00:00:00.000Z',
    }, editor);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current.project.scripts.length).toBe(1);
    expect(body.current.updatedAt).toBeTruthy();
  });

  it('only the owner can delete the project', async () => {
    const res = await json(`/v1/projects/${projectId}`, 'DELETE', undefined, editor);
    expect(res.status).toBe(404);
  });

  it('a revoked collaborator loses access', async () => {
    const list = await (await json(`/v1/projects/${projectId}/shares`, 'GET', undefined, owner)).json();
    const v = list.find((s: any) => s.role === 'viewer');
    expect((await json(`/v1/projects/${projectId}/shares/${v.id}`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await json(`/v1/projects/${projectId}`, 'GET', undefined, viewer)).status).toBe(404);
  });
});

describe('read-only link', () => {
  let token = '';

  it('mints once and returns the same token on a second mint', async () => {
    const a = await (await json(`/v1/projects/${projectId}/share-link`, 'POST', undefined, owner)).json();
    const b = await (await json(`/v1/projects/${projectId}/share-link`, 'POST', undefined, owner)).json();
    expect(a.token).toBeTruthy();
    expect(b.token).toBe(a.token);
    token = a.token;
  });

  it('serves a projection with no auth: final draft and boards only', async () => {
    const res = await app.request(`/v1/shared/${token}`);
    expect(res.status).toBe(200);
    const { project } = await res.json();
    expect(project.scripts).toHaveLength(1);
    expect(project.scripts[0].final).toBe(true);
    // What a script link does not promise must not be in the payload.
    expect(project.research).toEqual([]);
    expect(project.comments).toEqual([]);
    expect(project.contributors).toEqual([]);
  });

  it('rejects an unknown token', async () => {
    expect((await app.request('/v1/shared/not-a-real-token')).status).toBe(404);
  });

  it('revocation kills the link immediately', async () => {
    expect((await json(`/v1/projects/${projectId}/share-link`, 'DELETE', undefined, owner)).status).toBe(204);
    expect((await app.request(`/v1/shared/${token}`)).status).toBe(404);
  });
});

// Smoke tests over the real app, running against an in-memory SQLite database so
// they need no external infrastructure. The same code paths run on Postgres in
// prod (see src/db.ts); only the DATABASE_URL differs. Run with `bun test`.

import { describe, it, expect, beforeAll } from 'bun:test';

// Select the in-memory SQLite driver before anything imports config/db.
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
  name: 'The Shape of Memories',
  scripts: [
    { id: 's1', name: 'Final Draft', text: '.A FORCED HEADING\n\nAction line.\n', final: true },
    { id: 's2', name: 'Draft 1', text: 'INT. ROOM - DAY\n', final: false },
  ],
};

beforeAll(async () => {
  await migrate();
});

describe('pandemonium-api', () => {
  it('health check responds', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('runs register -> create -> read -> update with optimistic concurrency', async () => {
    const reg = await json('/v1/auth/register', 'POST', {
      email: 'writer@example.com', password: 'supersecret', displayName: 'Writer',
    });
    expect(reg.status).toBe(201);
    const { accessToken } = await reg.json();
    expect(typeof accessToken).toBe('string');

    const created = await json('/v1/projects', 'POST', { project: sampleProject }, accessToken);
    expect(created.status).toBe(201);
    const { id, updatedAt } = await created.json();
    expect(id).toBeTruthy();

    const got = await json(`/v1/projects/${id}`, 'GET', undefined, accessToken);
    expect(got.status).toBe(200);
    const fetched = await got.json();
    expect(fetched.project.scripts.length).toBe(2);

    // A stale baseUpdatedAt is rejected with 409.
    const stale = await json(`/v1/projects/${id}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: '1999-01-01T00:00:00.000Z',
    }, accessToken);
    expect(stale.status).toBe(409);

    // The correct baseUpdatedAt succeeds.
    const ok = await json(`/v1/projects/${id}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: updatedAt,
    }, accessToken);
    expect(ok.status).toBe(200);
  });

  it('logs in an existing user', async () => {
    const res = await json('/v1/auth/login', 'POST', {
      email: 'writer@example.com', password: 'supersecret',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe('writer@example.com');
  });

  it('rejects a wrong password', async () => {
    const res = await json('/v1/auth/login', 'POST', {
      email: 'writer@example.com', password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated project access', async () => {
    const res = await json('/v1/projects', 'GET');
    expect(res.status).toBe(401);
  });

  it('scopes projects to their owner', async () => {
    const reg = await json('/v1/auth/register', 'POST', {
      email: 'other@example.com', password: 'supersecret',
    });
    const { accessToken: otherToken } = await reg.json();
    // The other user sees none of writer's projects.
    const list = await json('/v1/projects', 'GET', undefined, otherToken);
    expect((await list.json()).length).toBe(0);
  });

  it('rejects a project with two final drafts (hard rule 4)', async () => {
    const reg = await json('/v1/auth/register', 'POST', {
      email: 'two@example.com', password: 'supersecret',
    });
    const { accessToken } = await reg.json();
    const bad = {
      name: 'Bad', scripts: [
        { id: 'a', name: 'Final Draft', text: '', final: true },
        { id: 'b', name: 'Other', text: '', final: true },
      ],
    };
    const res = await json('/v1/projects', 'POST', { project: bad }, accessToken);
    expect(res.status).toBe(400);
  });
});

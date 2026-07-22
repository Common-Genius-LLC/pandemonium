// Smoke tests over the real app. The health test always runs (it touches no
// database). The full auth + project-sync flow needs Postgres, so it is gated on
// RUN_DB_TESTS=1 with DATABASE_URL pointing at a disposable database:
//
//   docker compose up -d db
//   RUN_DB_TESTS=1 bun test
//
// Run with `bun test` (Bun's native runner; the server has no Vitest).

import { describe, it, expect, beforeAll } from 'bun:test';

const runDb = process.env.RUN_DB_TESTS === '1';

describe('health', () => {
  it('responds without a database', async () => {
    const { default: app } = await import('../src/app');
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

const sampleProject = {
  name: 'The Shape of Memories',
  scripts: [
    { id: 's1', name: 'Final Draft', text: '.A FORCED HEADING\n\nAction line.\n', final: true },
    { id: 's2', name: 'Draft 1', text: 'INT. ROOM - DAY\n', final: false },
  ],
};

describe.skipIf(!runDb)('auth + project sync (needs Postgres)', () => {
  let app: { request: typeof fetch | any };
  const uniqueEmail = `writer_${Date.now()}@example.com`;

  const json = (path: string, method: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    const { migrate } = await import('../src/db');
    await migrate();
    app = (await import('../src/app')).default;
  });

  it('runs register -> create -> read -> update with optimistic concurrency', async () => {
    const reg = await json('/v1/auth/register', 'POST', {
      email: uniqueEmail, password: 'supersecret', displayName: 'Writer',
    });
    expect(reg.status).toBe(201);
    const { accessToken } = await reg.json();
    expect(typeof accessToken).toBe('string');

    const created = await json('/v1/projects', 'POST', { project: sampleProject }, accessToken);
    expect(created.status).toBe(201);
    const { id, updatedAt } = await created.json();

    const got = await json(`/v1/projects/${id}`, 'GET', undefined, accessToken);
    expect(got.status).toBe(200);
    expect((await got.json()).project.scripts.length).toBe(2);

    const stale = await json(`/v1/projects/${id}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: '1999-01-01T00:00:00.000Z',
    }, accessToken);
    expect(stale.status).toBe(409);

    const ok = await json(`/v1/projects/${id}`, 'PUT', {
      project: sampleProject, baseUpdatedAt: updatedAt,
    }, accessToken);
    expect(ok.status).toBe(200);
  });

  it('rejects unauthenticated project access', async () => {
    const res = await json('/v1/projects', 'GET');
    expect(res.status).toBe(401);
  });

  it('rejects a project with two final drafts (hard rule 4)', async () => {
    const reg = await json('/v1/auth/register', 'POST', {
      email: `two_${Date.now()}@example.com`, password: 'supersecret',
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

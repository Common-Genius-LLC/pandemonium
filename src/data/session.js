// Client auth session and the single fetch path to the backend. This is the
// only new dependency the remote mode introduces: it holds the current mode
// ('local' | 'remote'), the in-memory access token, the signed-in user, and
// which remote project is currently open. Components never read process.env or
// build fetch headers themselves; they go through here (and through db.js).
//
// The access token lives in memory only (lost on reload, by design). Continuity
// across reloads comes from the httpOnly refresh cookie the backend sets: on
// boot, restore() trades that cookie for a fresh access token. The one durable
// client-side breadcrumb is the id of the last remote project opened, kept in
// localStorage so a reload reopens it.
'use strict';

const API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) || 'http://localhost:8787/v1';

const REMOTE_ID_KEY = 'pnd_remote_id';

class Session extends EventTarget {
  #mode = 'local';
  #accessToken = null;
  #user = null;
  #baseUpdatedAt = null; // optimistic-concurrency token for the open project

  get apiBase() { return API_BASE; }
  getMode() { return this.#mode; }
  isAuthed() { return this.#mode === 'remote' && !!this.#accessToken; }
  getUser() { return this.#user; }

  getCurrentRemoteId() {
    try { return localStorage.getItem(REMOTE_ID_KEY); } catch { return null; }
  }
  setCurrentRemoteId(id) {
    try {
      if (id) localStorage.setItem(REMOTE_ID_KEY, id);
      else localStorage.removeItem(REMOTE_ID_KEY);
    } catch { /* private mode: fall back to no persistence */ }
  }

  getBase() { return this.#baseUpdatedAt; }
  setBase(updatedAt) { this.#baseUpdatedAt = updatedAt || null; }

  #emit() { this.dispatchEvent(new CustomEvent('change')); }

  #enter(token, user) {
    this.#accessToken = token;
    this.#user = user;
    this.#mode = 'remote';
    this.#emit();
  }

  // ---- auth actions ----

  async register(email, password, displayName) {
    const out = await this.#authPost('/auth/register', { email, password, displayName });
    this.setCurrentRemoteId(null); // a fresh account owns no project yet
    this.#enter(out.accessToken, out.user);
    return out.user;
  }

  async login(email, password) {
    const out = await this.#authPost('/auth/login', { email, password });
    // Do not carry a previous account's remembered project into this one.
    this.setCurrentRemoteId(null);
    this.#enter(out.accessToken, out.user);
    return out.user;
  }

  async logout() {
    try {
      await fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* best effort: local sign-out proceeds regardless */ }
    this.#accessToken = null;
    this.#user = null;
    this.#mode = 'local';
    this.#baseUpdatedAt = null;
    this.setCurrentRemoteId(null);
    this.#emit();
  }

  // On boot: trade the refresh cookie for an access token, then load the user.
  // Silent no-op if the user was never signed in (no cookie).
  async restore() {
    try {
      const r = await fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!r.ok) return false;
      const { accessToken } = await r.json();
      this.#accessToken = accessToken;
      const me = await fetch(API_BASE + '/auth/me', {
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      this.#user = me.ok ? (await me.json()).user : null;
      this.#mode = 'remote';
      this.#emit();
      return true;
    } catch {
      return false; // backend unreachable: stay in local mode
    }
  }

  async #authPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // ---- authenticated fetch ----

  // Attaches the Bearer token and, on a 401, transparently refreshes once and
  // retries. Returns the raw Response so callers can branch on status (e.g. the
  // 409 conflict path in the project adapter).
  async apiFetch(path, opts = {}) {
    const run = () =>
      fetch(API_BASE + path, {
        ...opts,
        headers: {
          'content-type': 'application/json',
          ...(this.#accessToken ? { authorization: `Bearer ${this.#accessToken}` } : {}),
          ...(opts.headers || {}),
        },
        credentials: 'include',
      });

    let res = await run();
    if (res.status === 401 && (await this.#silentRefresh())) {
      res = await run();
    }
    return res;
  }

  async #silentRefresh() {
    try {
      const r = await fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!r.ok) return false;
      this.#accessToken = (await r.json()).accessToken;
      return true;
    } catch {
      return false;
    }
  }
}

export const session = new Session();

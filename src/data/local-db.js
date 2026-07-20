// Autosave: the current project is written to IndexedDB continuously (see
// db.js's debounced call site) so reloading the page, or coming back
// tomorrow, restores exactly where you left off -- no more "download a
// .pandemonium.json file" as the only way anything survives a refresh.
// Explicit Save/Open (local-file-adapter.js) still exist for portable
// backups and sharing a project as a file; this is a separate, lower-
// friction slot for day-to-day continuity. IndexedDB rather than
// localStorage specifically because embedded board images are data URLs
// that can run into the low tens of megabytes, well past localStorage's
// ~5-10MB quota.
'use strict';

const DB_NAME = 'pandemonium';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const CURRENT_KEY = 'current';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB is not available in this browser.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, run) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = run(store);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function saveCurrentProjectLocally(project) {
  return withStore('readwrite', (store) => store.put({ app: 'pandemonium', v: 1, saved: new Date().toISOString(), project }, CURRENT_KEY));
}

export async function loadCurrentProjectLocally() {
  const record = await withStore('readonly', (store) => store.get(CURRENT_KEY));
  return record ? record.project : null;
}

export function clearCurrentProjectLocally() {
  return withStore('readwrite', (store) => store.delete(CURRENT_KEY));
}

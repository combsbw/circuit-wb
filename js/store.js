// IndexedDB persistence: saved designs + autosave of the working session.
const DB_NAME = 'circuit-workbench';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const store = {
  async listDesigns() {
    const all = (await tx('designs', 'readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  getDesign: (id) => tx('designs', 'readonly', (s) => s.get(id)),
  putDesign: (d) => tx('designs', 'readwrite', (s) => s.put(d)),
  deleteDesign: (id) => tx('designs', 'readwrite', (s) => s.delete(id)),
  getState: (key) => tx('state', 'readonly', (s) => s.get(key)),
  putState: (key, v) => tx('state', 'readwrite', (s) => s.put(v, key)),
  async persist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
    return false;
  },
};

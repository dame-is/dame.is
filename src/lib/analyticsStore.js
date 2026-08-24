// The Analytics studio's archive — IndexedDB, because the post archive is the
// one dataset in this codebase too big for anything else: ~25,000 compact rows
// is ~6 MB of JSON, past localStorage's quota and far past what should be
// re-fetched on every visit (a full sweep is ~250 sequential AppView pages).
//
// This is deliberately NOT the admin counts cache (useAdminData.js), whose
// in-memory 60s TTL is right for numbers glanced at between edits. An archive
// is the opposite lifetime: fetched once expensively, topped up cheaply, and
// expected to still be there next week.
//
// Everything degrades. If IndexedDB is absent (node, private windows) or any
// call throws (quota, eviction mid-transaction), the same API is served from
// an in-memory Map — the studio works for the session and simply re-syncs
// next time. No caller ever sees an IDB error; they see an empty archive.

const DB_NAME = 'dame-analytics';
const DB_VERSION = 1;

/** store name → keyPath. One object store per archive, plus sync metadata. */
const STORES = {
  posts: 'uri', // compact post rows (analytics.js compactPostFromFeedItem)
  followers: 'did', // { did, handle, displayName, avatar, followedAt }
  inbound: 'uri', // engagement events aimed at the owner
  outbound: 'uri', // the owner's like/repost events (replies/quotes derive from posts)
  actors: 'did', // resolved profile cards for the People lists
  meta: 'key', // { key, ...facts } — sync stamps, coverage marks
};

let _handlePromise = null;

/**
 * Open (once) and return the store handle:
 *
 *   all(store)            → Promise<row[]>
 *   putAll(store, rows)   → Promise<void>   (one transaction, ignores [] )
 *   clear(store)          → Promise<void>
 *   getMeta(key)          → Promise<object|null>
 *   setMeta(key, facts)   → Promise<void>
 *   persistent            true when rows will survive a reload
 *
 * The handle is memoized: every consumer shares one connection, and a failed
 * open memoizes the memory fallback rather than retrying per call.
 */
export function openAnalyticsStore() {
  if (!_handlePromise) {
    _handlePromise = openIdb()
      .then((db) => idbHandle(db))
      .catch(() => memoryHandle());
  }
  return _handlePromise;
}

/** Test seam: forget the memoized handle (and its fake DB) between tests. */
export function resetAnalyticsStore() {
  _handlePromise = null;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function idbHandle(db) {
  // Any structural failure after open (a store missing because a future
  // version renamed it, an eviction mid-write) downgrades that CALL to the
  // fallback result rather than throwing into the studio.
  const tx = (store, mode) =>
    new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(store, mode);
      } catch (err) {
        reject(err);
        return;
      }
      resolve(t.objectStore(store));
    });

  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

  return {
    persistent: true,
    async all(store) {
      try {
        return (await request((await tx(store, 'readonly')).getAll())) || [];
      } catch {
        return [];
      }
    },
    async putAll(store, rows) {
      if (!rows || rows.length === 0) return;
      try {
        const os = await tx(store, 'readwrite');
        for (const row of rows) if (row && row[STORES[store]] != null) os.put(row);
        await new Promise((resolve, reject) => {
          os.transaction.oncomplete = resolve;
          os.transaction.onerror = () => reject(os.transaction.error);
          os.transaction.onabort = () => reject(os.transaction.error || new Error('aborted'));
        });
      } catch {
        /* dropped — the next sync rebuilds what this write lost */
      }
    },
    async clear(store) {
      try {
        const os = await tx(store, 'readwrite');
        await request(os.clear());
      } catch {
        /* ignore */
      }
    },
    async getMeta(key) {
      try {
        return (await request((await tx('meta', 'readonly')).get(key))) || null;
      } catch {
        return null;
      }
    },
    async setMeta(key, facts) {
      await this.putAll('meta', [{ ...facts, key }]);
    },
  };
}

function memoryHandle() {
  const mem = new Map(Object.keys(STORES).map((name) => [name, new Map()]));
  return {
    persistent: false,
    async all(store) {
      return Array.from(mem.get(store)?.values() || []);
    },
    async putAll(store, rows) {
      const m = mem.get(store);
      if (!m) return;
      for (const row of rows || []) {
        const key = row?.[STORES[store]];
        if (key != null) m.set(key, row);
      }
    },
    async clear(store) {
      mem.get(store)?.clear();
    },
    async getMeta(key) {
      return mem.get('meta').get(key) || null;
    },
    async setMeta(key, facts) {
      mem.get('meta').set(key, { ...facts, key });
    },
  };
}

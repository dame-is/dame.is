// Stand-in for src/hooks/useAtprotoSession.jsx, swapped in by
// vite.harness.config.js. Presents a signed-in owner session backed by the
// in-memory fixture repo, so every admin surface can be opened, read, edited
// and screenshotted without an OAuth round trip.
//
// The real module's exported shape is mirrored exactly — if it grows an export,
// this needs the same one. Nothing here ships; see harness/README.md.

import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { ME_DID, ME_HANDLE } from '../src/config.js';
import { buildRepo } from './fixtures.js';

const Ctx = createContext(null);

/** Latency, in ms, applied to every fake XRPC call. `?latency=0` to disable. */
function configuredLatency() {
  const v = new URLSearchParams(window.location.search).get('latency');
  return v === null ? 120 : Number(v) || 0;
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function rkeyFromUri(u) {
  return String(u || '').split('/').pop();
}

/** Mint a plausible TID for records the harness creates during a session. */
function newTid() {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  let n = Date.now();
  let out = '';
  for (let i = 0; i < 11; i++) {
    out = alphabet[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return `3l${out}`.slice(0, 13);
}

/**
 * A REAL TID for a given timestamp — bit-exact encoding, so the analytics
 * studio's tidToTimestamp round-trips it. `newTid` above is only shaped like
 * one; the follow-date reconstruction needs the genuine article.
 */
function tidAt(ms) {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  const t = Math.floor(ms);
  let n = ((BigInt(t) * 1000n) << 10n) | BigInt(t % 1024);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = alphabet[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** Tiny deterministic RNG so the analytics fixtures hold still. */
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAST = [
  ['did:plc:harnessana', 'ana.example.com', 'Ana'],
  ['did:plc:harnessbo', 'bo.example.com', 'Bo'],
  ['did:plc:harnesscy', 'cyrus.example.com', 'Cyrus'],
  ['did:plc:harnessdee', 'dee.example.com', 'Dee'],
  ['did:plc:harnessed', 'edna.example.com', 'Edna'],
  ['did:plc:harnessfio', 'fio.example.com', 'Fio'],
];

/**
 * The Analytics studio's read surface, synthesized once per session:
 * ~340 followers whose follow-record TIDs trace an accelerating two-year
 * curve, and ~90 days of notifications from a small cast. Pure reads — the
 * studio treats them exactly like AppView answers. (Its POST sweep never
 * touches the agent: it walks the real public AppView, harness included.)
 */
function buildAnalyticsFixtures() {
  const rand = mulberry(20260402);
  const now = Date.now();
  const twoYears = 2 * 365 * 86_400_000;

  const followers = Array.from({ length: 340 }, (_, i) => {
    // quadratic ease-in: sparse early, busy lately — a believable curve.
    const frac = 1 - Math.pow(1 - i / 340, 2);
    const at = now - twoYears + frac * twoYears - rand() * 86_400_000;
    return {
      did: `did:plc:harnessfan${String(i).padStart(4, '0')}`,
      handle: `fan${i}.example.com`,
      displayName: `Fan ${i}`,
      avatar: '',
      viewer: { followedBy: `at://did:plc:harnessfan${i}/app.bsky.graph.follow/${tidAt(at)}` },
    };
  }).reverse(); // getFollowers pages newest-first

  const reasons = ['like', 'like', 'like', 'repost', 'reply', 'quote', 'mention', 'follow'];
  const notifications = Array.from({ length: 420 }, (_, i) => {
    const at = now - rand() * 90 * 86_400_000;
    const [did, handle, displayName] = CAST[Math.floor(rand() * CAST.length)];
    const reason = reasons[Math.floor(rand() * reasons.length)];
    return {
      uri: `at://${did}/app.bsky.notification.fake/${i}`,
      reason,
      author: { did, handle, displayName },
      record: { createdAt: new Date(at).toISOString() },
      indexedAt: new Date(at).toISOString(),
    };
  }).sort((a, b) => (a.indexedAt < b.indexedAt ? 1 : -1));

  return { followers, notifications };
}

/**
 * An `@atproto/api` Agent stand-in covering the repo methods the app calls
 * (verified with: grep -rhoE "agent\.[a-zA-Z0-9_.]+\(" src/), plus the three
 * read-only calls the Analytics studio makes (describeRepo, getFollowers,
 * listNotifications), answered from the synthesized fixtures above.
 * Writes mutate the in-memory repo, so edits persist for the page's lifetime
 * and lists reflect them — enough to exercise save, delete and bulk actions.
 */
function makeAgent(repo, bump) {
  const latency = configuredLatency();
  const listOf = (c) => (repo[c] ||= []);
  const analytics = buildAnalyticsFixtures();
  const page = (all, limit, cursor) => {
    const start = cursor ? Number(cursor) || 0 : 0;
    const slice = all.slice(start, start + limit);
    const next = start + limit;
    return { slice, cursor: next < all.length ? String(next) : undefined };
  };

  return {
    app: {
      bsky: {
        graph: {
          async getFollowers({ limit = 50, cursor }) {
            await sleep(latency);
            const { slice, cursor: next } = page(analytics.followers, limit, cursor);
            return { data: { followers: slice, cursor: next } };
          },
        },
        notification: {
          async listNotifications({ limit = 50, cursor }) {
            await sleep(latency);
            const { slice, cursor: next } = page(analytics.notifications, limit, cursor);
            return { data: { notifications: slice, cursor: next } };
          },
        },
      },
    },
    com: {
      atproto: {
        repo: {
          async describeRepo({ repo: did }) {
            await sleep(latency);
            return { data: { did, collections: Object.keys(repo), handle: ME_HANDLE } };
          },

          async listRecords({ collection, limit = 50, cursor }) {
            await sleep(latency);
            const all = listOf(collection);
            const start = cursor ? Number(cursor) || 0 : 0;
            const slice = all.slice(start, start + limit);
            const next = start + limit;
            return {
              data: {
                records: slice.map((r) => ({ ...r, value: { ...r.value } })),
                cursor: next < all.length ? String(next) : undefined,
              },
            };
          },

          async getRecord({ collection, rkey }) {
            await sleep(latency);
            const hit = listOf(collection).find((r) => rkeyFromUri(r.uri) === rkey);
            if (!hit) {
              const err = new Error(`Could not locate record: ${collection}/${rkey}`);
              err.status = 400;
              throw err;
            }
            return { data: { uri: hit.uri, cid: hit.cid, value: { ...hit.value } } };
          },

          async putRecord({ repo: did, collection, rkey, record }) {
            await sleep(latency);
            const all = listOf(collection);
            const at = all.findIndex((r) => rkeyFromUri(r.uri) === rkey);
            const entry = {
              uri: `at://${did || ME_DID}/${collection}/${rkey}`,
              cid: `bafyharness${Date.now().toString(36)}`,
              value: { ...record },
            };
            if (at === -1) all.unshift(entry);
            else all[at] = entry;
            bump();
            return { data: { uri: entry.uri, cid: entry.cid } };
          },

          async createRecord({ repo: did, collection, rkey, record }) {
            await sleep(latency);
            const key = rkey || newTid();
            const entry = {
              uri: `at://${did || ME_DID}/${collection}/${key}`,
              cid: `bafyharness${Date.now().toString(36)}`,
              value: { ...record },
            };
            listOf(collection).unshift(entry);
            bump();
            return { data: { uri: entry.uri, cid: entry.cid } };
          },

          async deleteRecord({ collection, rkey }) {
            await sleep(latency);
            const all = listOf(collection);
            const at = all.findIndex((r) => rkeyFromUri(r.uri) === rkey);
            if (at !== -1) all.splice(at, 1);
            bump();
            return { data: {} };
          },

          async uploadBlob(bytes, opts) {
            await sleep(latency);
            return {
              data: {
                blob: {
                  $type: 'blob',
                  ref: { $link: `bafkharnessblob${Date.now().toString(36)}` },
                  mimeType: opts?.encoding || 'image/jpeg',
                  size: bytes?.size ?? bytes?.byteLength ?? 0,
                },
              },
            };
          },
        },
      },
    },
  };
}

export function AtprotoSessionProvider({ children }) {
  const repoRef = useRef(null);
  if (!repoRef.current) repoRef.current = buildRepo();
  const [, setTick] = useState(0);

  const value = useMemo(() => {
    const agent = makeAgent(repoRef.current, () => setTick((t) => t + 1));
    return {
      session: { did: ME_DID, handle: ME_HANDLE, sub: ME_DID },
      agent,
      did: ME_DID,
      handle: ME_HANDLE,
      loading: false,
      error: null,
      signIn: async () => {},
      signOut: async () => {},
    };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession (harness) used outside AtprotoSessionProvider');
  return v;
}

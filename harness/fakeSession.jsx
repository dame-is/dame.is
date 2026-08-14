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
 * An `@atproto/api` Agent stand-in covering exactly the six repo methods the
 * app calls (verified with: grep -rhoE "agent\.[a-zA-Z0-9_.]+\(" src/).
 * Writes mutate the in-memory repo, so edits persist for the page's lifetime
 * and lists reflect them — enough to exercise save, delete and bulk actions.
 */
function makeAgent(repo, bump) {
  const latency = configuredLatency();
  const listOf = (c) => (repo[c] ||= []);

  return {
    com: {
      atproto: {
        repo: {
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The reads every public Ratioed surface shares (see "Shared reads" in
// ratioed.js). The essay mounts seven chart blocks, and what is pinned here is
// that seven callers make one request for each thing — not seven, and not
// seven times the number of states the pieces pass through.
//
// Each test gets a fresh copy of the module, because the whole point of it is
// state that outlives a call.

const SUBJECT = (n) => `at://did:plc:me/app.bsky.feed.post/take${n}`;
const record = (take, extra = {}) => ({
  uri: `at://did:plc:me/is.dame.creating.ratioed.piece/rk${take}`,
  value: {
    take,
    subject: SUBJECT(take),
    postedAt: '2026-08-17T00:00:00.000Z',
    sealedAt: '2026-08-17T00:15:00.000Z',
    lifespanMs: 900_000,
    preSeal: { likes: 1 },
    postSeal: {},
    ...extra,
  },
});

let calls;
let answers;

function respond(body, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.resetModules();
  calls = [];
  answers = {
    snapshot: [record(1), record(2)],
    people: [{ did: 'did:plc:a', h: 'a.test', pre: [1], post: [] }],
    pds: [record(1), record(2), record(3)],
    links: {
      links: { 'app.bsky.feed.like': { '.subject.uri': { records: 4 } } },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = String(url);
      calls.push(u);
      if (u === '/data/ratioed.json') return respond(answers.snapshot);
      if (u === '/data/ratioedPeople.json') return respond(answers.people);
      if (u.startsWith('https://plc.directory/')) {
        return respond({
          service: [
            { id: '#atproto_pds', serviceEndpoint: 'https://pds.test' },
          ],
        });
      }
      if (u.startsWith('https://pds.test/xrpc/com.atproto.repo.listRecords')) {
        return respond({ records: answers.pds });
      }
      if (u.includes('/links/all')) return respond(answers.links);
      return respond({}, false);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const count = (prefix) => calls.filter((u) => u.startsWith(prefix)).length;

describe('shared reads', () => {
  it('reads the snapshot once for every caller, at once or later', async () => {
    const { loadPieces } = await import('./ratioed.js');
    const all = await Promise.all(
      Array.from({ length: 7 }, () => loadPieces(null)),
    );
    await loadPieces(null);
    expect(count('/data/ratioed.json')).toBe(1);
    expect(all.every((p) => p.length === 2)).toBe(true);
  });

  it('reads the roster once', async () => {
    const { loadPeople } = await import('./ratioed.js');
    await Promise.all([loadPeople(), loadPeople(), loadPeople()]);
    expect(count('/data/ratioedPeople.json')).toBe(1);
  });

  it('asks again after a snapshot that never arrived', async () => {
    answers.snapshot = null;
    const { loadPieces, SEED_PIECES } = await import('./ratioed.js');
    expect(await loadPieces(null)).toBe(SEED_PIECES);
    answers.snapshot = [record(1)];
    expect(await loadPieces(null)).toHaveLength(1);
    expect(count('/data/ratioed.json')).toBe(2);
  });

  it('makes one PLC lookup and one listRecords for seven blocks', async () => {
    const { loadLivePieces } = await import('./ratioed.js');
    const all = await Promise.all(
      Array.from({ length: 7 }, () => loadLivePieces()),
    );
    expect(count('https://plc.directory/')).toBe(1);
    expect(count('https://pds.test/')).toBe(1);
    // Merged over the snapshot, so the take only the PDS has is there.
    expect(all[0].map((p) => p.take)).toEqual([1, 2, 3]);
  });

  it('answers null, and forgets, when the PDS could not be read', async () => {
    answers.pds = null;
    const { loadLivePieces } = await import('./ratioed.js');
    expect(await loadLivePieces()).toBeNull();
    answers.pds = [record(1)];
    expect((await loadLivePieces()).map((p) => p.take)).toEqual([1, 2]);
  });

  it('hands the studio its own fresh read, and shares it afterwards', async () => {
    const { readPieces, loadLivePieces } = await import('./ratioed.js');
    await loadLivePieces();
    answers.pds = [...answers.pds, record(4)];
    const studio = await readPieces('https://pds.test');
    expect(studio.source).toBe('pds');
    expect(count('https://pds.test/')).toBe(2);
    // The next public page sees the take the studio just read, without a
    // third listRecords.
    expect((await loadLivePieces()).map((p) => p.take)).toEqual([1, 2, 3, 4]);
    expect(count('https://pds.test/')).toBe(2);
  });

  it('asks Constellation once per post however many callers ask', async () => {
    const { fetchLiveDeltas, normalizePiece } = await import('./ratioed.js');
    const pieces = [1, 2, 3].map((n) =>
      normalizePiece(`rk${n}`, record(n).value),
    );
    // Two blocks, each passing through the bundle, the snapshot and the PDS.
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => fetchLiveDeltas(pieces)),
    );
    expect(count('https://constellation.microcosm.blue/links/all')).toBe(3);
    // 4 likes now, 1 recorded alive: 3 since.
    expect(runs.every((d) => d.rk1.likes === 3)).toBe(true);
  });

  it('does not keep a failed Constellation answer as the answer', async () => {
    answers.links = null;
    const { fetchLiveDeltas, normalizePiece } = await import('./ratioed.js');
    const piece = normalizePiece('rk1', record(1).value);
    expect(await fetchLiveDeltas([piece])).toEqual({});
    answers.links = { links: {} };
    await fetchLiveDeltas([piece]);
    expect(count('https://constellation.microcosm.blue/links/all')).toBe(2);
  });
});

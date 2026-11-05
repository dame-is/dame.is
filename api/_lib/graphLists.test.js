// The sync path against a fake PDS: reads the rule and the list, writes only
// the difference, records counts (not names), and never touches a list it did
// not make.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const LIST = `at://${ME}/app.bsky.graph.list/3mlist`;
const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();

const repo = new Map();
const writes = [];
const puts = [];

function seed() {
  repo.clear();
  writes.length = 0;
  puts.length = 0;
  repo.set('is.dame.graph.list', [
    {
      uri: `at://${ME}/is.dame.graph.list/fans`,
      value: {
        kind: 'engaged-in',
        name: 'Fans',
        listUri: LIST,
        size: 2,
        minInteractions: 2,
        enabled: true,
      },
    },
  ]);
  repo.set('app.bsky.graph.listitem', [
    {
      uri: `at://${ME}/app.bsky.graph.listitem/k1`,
      value: { list: LIST, subject: 'did:plc:stays' },
    },
    {
      uri: `at://${ME}/app.bsky.graph.listitem/k2`,
      value: { list: LIST, subject: 'did:plc:gone' },
    },
    // A hand-made list's member: must never be read as this list's.
    {
      uri: `at://${ME}/app.bsky.graph.listitem/k3`,
      value: {
        list: 'at://x/app.bsky.graph.list/other',
        subject: 'did:plc:gone',
      },
    },
  ]);
}

vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    async login() {}
    com = {
      atproto: {
        repo: {
          listRecords: async ({ collection }) => ({
            data: { records: repo.get(collection) || [] },
          }),
          applyWrites: async ({ writes: w }) => writes.push(...w),
          putRecord: async (args) => puts.push(args),
        },
      },
    };
  },
}));

vi.mock('../../src/lib/atproto.js', async (orig) => ({
  ...(await orig()),
  resolveIdentifier: async () => ({ did: ME, pds: 'https://pds.example' }),
  resolveProfiles: async () => ({}),
}));

vi.mock('../../src/lib/analyticsSync.js', () => ({
  sweepInbound: async () => ({
    events: [
      { uri: '1', did: 'did:plc:stays', kind: 'like', at: recent },
      { uri: '2', did: 'did:plc:stays', kind: 'like', at: recent },
      { uri: '3', did: 'did:plc:new', kind: 'reply', at: recent },
      { uri: '4', did: 'did:plc:new', kind: 'like', at: recent },
      { uri: '5', did: 'did:plc:modlisted', kind: 'reply', at: recent },
      { uri: '6', did: 'did:plc:modlisted', kind: 'reply', at: recent },
    ],
    complete: true,
    error: null,
  }),
  sweepOutbound: async () => ({ events: [], complete: true, error: null }),
  sweepFollowing: async () => ({ following: [], complete: true, error: null }),
}));

vi.mock('./modDb.js', () => ({ select: async () => [] }));
vi.mock('./graphFacts.js', () => ({
  graphFacts: async () => ({ listed: new Set(['did:plc:modlisted']) }),
}));

describe('syncAll', () => {
  beforeEach(() => {
    seed();
    process.env.BSKY_APP_PASSWORD = 'test';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ relationships: [] }),
    }));
  });

  it('writes the difference and records counts only', async () => {
    const { syncAll } = await import('./graphLists.js');
    const out = await syncAll();

    expect(writes).toEqual([
      {
        $type: 'com.atproto.repo.applyWrites#delete',
        collection: 'app.bsky.graph.listitem',
        rkey: 'k2',
      },
      expect.objectContaining({
        $type: 'com.atproto.repo.applyWrites#create',
        value: expect.objectContaining({ subject: 'did:plc:new', list: LIST }),
      }),
    ]);
    expect(out.lists[0]).toMatchObject({
      key: 'fans',
      added: 1,
      removed: 1,
      size: 2,
      error: null,
    });

    const status = puts.find((p) => p.collection === 'is.dame.graph.list');
    expect(status.rkey).toBe('fans');
    expect(status.record.lastSync).toMatchObject({ added: 1, removed: 1 });
    expect(JSON.stringify(status.record)).not.toContain('did:plc:new');
  });
});

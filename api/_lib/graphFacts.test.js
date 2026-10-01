import { describe, it, expect, vi, beforeEach } from 'vitest';

const constellation = {
  getBacklinks: vi.fn(),
  getManyToMany: vi.fn(),
};
vi.mock('../../src/lib/constellation.js', () => constellation);
vi.mock('../../src/lib/atproto.js', () => ({
  resolvePds: vi.fn(async () => 'https://pds.test'),
}));

const facts = await import('./graphFacts.js');

const LIST = 'at://did:plc:bot/app.bsky.graph.list/3list';
const listitem = (did, rkey, list = LIST) => ({
  linkRecord: {
    did: 'did:plc:bot',
    collection: 'app.bsky.graph.listitem',
    rkey,
  },
  otherSubject: list,
});

beforeEach(() => {
  facts.resetGraphFacts();
  constellation.getBacklinks.mockReset();
  constellation.getManyToMany.mockReset();
});

describe('who blocks dame', () => {
  it('asks for fifty accounts at a time, filtered by account', async () => {
    constellation.getBacklinks.mockImplementation(async (_t, _s, { dids }) => ({
      records: dids.filter((d) => d.endsWith('7')).map((did) => ({ did })),
    }));
    const dids = Array.from({ length: 60 }, (_, i) => `did:plc:x${i}`);
    const out = await facts.whoBlocks(dids);
    expect(constellation.getBacklinks).toHaveBeenCalledTimes(2);
    expect(constellation.getBacklinks.mock.calls[0][2].dids).toHaveLength(50);
    expect([...out].sort()).toEqual([
      'did:plc:x17',
      'did:plc:x27',
      'did:plc:x37',
      'did:plc:x47',
      'did:plc:x57',
      'did:plc:x7',
    ]);
  });

  it('says it could not tell rather than "nobody"', async () => {
    constellation.getBacklinks.mockResolvedValue(null);
    expect(await facts.whoBlocks(['did:plc:a'])).toBe(null);
  });
});

describe('membership for a write', () => {
  it('asks Constellation about the one account, filtered to this list', async () => {
    constellation.getManyToMany.mockResolvedValue({
      items: [
        listitem('did:plc:a', 'r1'),
        listitem('did:plc:a', 'r9', 'at://other/list'),
      ],
      cursor: null,
    });
    expect(await facts.rkeysForWrite(LIST, 'did:plc:a')).toEqual(['r1']);
    expect(constellation.getManyToMany.mock.calls[0][3].otherSubject).toBe(
      LIST,
    );
  });

  it("covers Constellation's lag with this process's own writes", async () => {
    constellation.getManyToMany.mockResolvedValue({ items: [], cursor: null });
    facts.noteListed(LIST, 'did:plc:a', 'rNew');
    // Just added, not indexed yet: a second "block" must see it.
    expect(await facts.rkeysForWrite(LIST, 'did:plc:a')).toEqual(['rNew']);
    expect(facts.isListed(LIST, 'did:plc:a')).toBe(true);

    constellation.getManyToMany.mockResolvedValue({
      items: [listitem('did:plc:b', 'rOld')],
      cursor: null,
    });
    facts.noteUnlisted(LIST, 'did:plc:b');
    // Just removed, still indexed: not on the list any more.
    expect(await facts.rkeysForWrite(LIST, 'did:plc:b')).toEqual([]);
    expect(facts.isListed(LIST, 'did:plc:b')).toBe(false);
  });

  it('walks the repo when Constellation cannot say', async () => {
    constellation.getManyToMany.mockResolvedValue(null);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        records: [
          {
            uri: 'at://did:plc:bot/app.bsky.graph.listitem/r1',
            value: { list: LIST, subject: 'did:plc:a' },
          },
          {
            uri: 'at://did:plc:bot/app.bsky.graph.listitem/r2',
            value: { list: LIST, subject: 'did:plc:a' },
          },
          {
            uri: 'at://did:plc:bot/app.bsky.graph.listitem/r3',
            value: { list: 'other', subject: 'did:plc:a' },
          },
        ],
      }),
    }));
    const listed = await facts.readListed(LIST, { fetchImpl });
    // Duplicates are kept: taking someone off means deleting every copy.
    expect(listed.get('did:plc:a')).toEqual(['r1', 'r2']);
  });
});

describe('the held copy, for reading many at once', () => {
  it('is unknown until loaded, and the scorer only ever sees true', () => {
    expect(facts.isListed(LIST, 'did:plc:a')).toBe(null);
    expect(facts.blocksMe('did:plc:a')).toBe(null);
    expect(facts.listedView(LIST).has('did:plc:a')).toBe(false);
  });
});

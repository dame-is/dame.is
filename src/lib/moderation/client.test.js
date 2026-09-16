import { describe, it, expect, vi, afterEach } from 'vitest';
import { removeFromList, describeEngagements } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = 'did:plc:me';
const BOT = 'did:plc:bot';

/**
 * A stub OAuth agent.
 *
 * `listRecords` answers with whatever the repo it is asked for actually holds,
 * which is the whole point: the bug this file guards against was code that
 * asked the wrong repo and believed the empty answer.
 */
function fakeAgent(repos) {
  return {
    session: { did: ME },
    com: {
      atproto: {
        repo: {
          listRecords: vi.fn(async ({ repo }) => ({
            data: { records: repos[repo] || [], cursor: undefined },
          })),
          applyWrites: vi.fn(async () => ({})),
        },
        server: {
          getServiceAuth: vi.fn(async () => ({ data: { token: 'tok' } })),
        },
      },
    },
  };
}

const listitem = (owner, listUri, subject, rkey) => ({
  uri: `at://${owner}/app.bsky.graph.listitem/${rkey}`,
  value: { list: listUri, subject },
});

describe('removeFromList', () => {
  it('deletes in the browser when the list is the viewer’s own', async () => {
    const listUri = `at://${ME}/app.bsky.graph.list/abc`;
    const agent = fakeAgent({
      [ME]: [
        listitem(ME, listUri, 'did:plc:a', 'r1'),
        listitem(ME, listUri, 'did:plc:b', 'r2'),
        listitem(ME, 'at://other/list/x', 'did:plc:a', 'r3'),
      ],
    });

    const out = await removeFromList(agent, listUri, [
      'did:plc:a',
      'did:plc:b',
    ]);
    expect(out).toEqual({ removed: 2, found: 2, asked: 2 });

    const writes = agent.com.atproto.repo.applyWrites.mock.calls[0][0];
    expect(writes.repo).toBe(ME);
    // r3 belongs to a different list and must survive.
    expect(writes.writes.map((w) => w.rkey).sort()).toEqual(['r1', 'r2']);
  });

  it('hands off to the server when the list belongs to the bot', async () => {
    // The regression. The old code asked for ME's records, found none matching
    // a bot-owned list, and returned removed:0 as though it had succeeded.
    const listUri = `at://${BOT}/app.bsky.graph.list/abc`;
    const agent = fakeAgent({ [ME]: [], [BOT]: [] });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ removed: 2, found: 2, asked: 2 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await removeFromList(agent, listUri, [
      'did:plc:a',
      'did:plc:b',
    ]);
    expect(out.removed).toBe(2);
    expect(agent.com.atproto.repo.applyWrites).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mod-remove');
    expect(JSON.parse(init.body)).toEqual({
      listUri,
      dids: ['did:plc:a', 'did:plc:b'],
    });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('never silently reports success against the wrong repo', async () => {
    // Stated as its own case because the failure mode is indistinguishable from
    // "nobody matched" unless something asserts on it.
    const listUri = `at://${BOT}/app.bsky.graph.list/abc`;
    const agent = fakeAgent({ [ME]: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: 'not the owner' }),
      })),
    );
    await expect(removeFromList(agent, listUri, ['did:plc:a'])).rejects.toThrow(
      /not the owner/,
    );
  });

  it('rejects a listUri that is not an at:// URI', async () => {
    const agent = fakeAgent({});
    await expect(
      removeFromList(agent, 'https://bsky.app/profile/x/lists/y', [
        'did:plc:a',
      ]),
    ).rejects.toThrow(/at:\/\/ URI/);
  });

  it('does nothing, and calls nothing, for an empty selection', async () => {
    const agent = fakeAgent({});
    const out = await removeFromList(
      agent,
      `at://${ME}/app.bsky.graph.list/a`,
      [],
    );
    expect(out).toEqual({ removed: 0, found: 0, asked: 0 });
    expect(agent.com.atproto.repo.listRecords).not.toHaveBeenCalled();
  });

  it('deduplicates the requested DIDs', async () => {
    const listUri = `at://${ME}/app.bsky.graph.list/abc`;
    const agent = fakeAgent({
      [ME]: [listitem(ME, listUri, 'did:plc:a', 'r1')],
    });
    const out = await removeFromList(agent, listUri, [
      'did:plc:a',
      'did:plc:a',
    ]);
    expect(out.asked).toBe(1);
  });
});

describe('describeEngagements', () => {
  it('reads a row aloud, with counts only where they add something', () => {
    expect(describeEngagements({ like: 1, reply: 3 })).toBe(
      'liked, replied ×3',
    );
    expect(describeEngagements({})).toBe('');
  });

  it('falls back to the raw kind for a lexicon it has no label for', () => {
    expect(describeEngagements({ 'at.margin.bookmark': 1 })).toBe(
      'at.margin.bookmark',
    );
  });
});

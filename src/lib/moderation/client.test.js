import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeEngagements } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const ME = 'did:plc:me';
const BOT = 'did:plc:bot';
const exp = () => Math.floor(Date.now() / 1000) + 120;
const jwt = (payload) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

/** A stub OAuth agent whose PDS mints a token for whatever it is asked. */
function fakeAgent() {
  return {
    session: { did: ME },
    com: {
      atproto: {
        server: {
          getServiceAuth: vi.fn(async ({ aud, lxm }) => ({
            data: { token: jwt({ iss: ME, aud, lxm, exp: exp() }) },
          })),
        },
      },
    },
  };
}

/** A fetch that answers from `routes` and records what was sent. */
function fakeFetch(routes) {
  const sent = [];
  const fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'https://site.invalid');
    const body = init.body ? JSON.parse(init.body) : null;
    sent.push({
      path: u.pathname,
      query: u.searchParams,
      body,
      headers: init.headers || {},
    });
    const answer = routes[`${init.method || 'GET'} ${u.pathname}`];
    const out =
      typeof answer === 'function' ? answer(body, u.searchParams) : answer;
    return {
      ok: Boolean(out),
      status: out ? 200 : 404,
      json: async () => out || { error: 'nothing there' },
      text: async () => JSON.stringify(out || { error: 'nothing there' }),
    };
  });
  return { fetch, sent };
}

/** The client module with the bot's address and DID set, as a build would. */
async function withBot() {
  vi.stubEnv('VITE_MOD_API_URL', 'https://mod.example.com');
  vi.stubEnv('VITE_MOD_BOT_DID', BOT);
  vi.resetModules();
  return import('./client.js');
}

describe('the bot', () => {
  it('says what is missing when the build was not told where the bot is', async () => {
    vi.stubEnv('VITE_MOD_API_URL', '');
    vi.stubEnv('VITE_MOD_BOT_DID', '');
    vi.resetModules();
    const { bot } = await import('./client.js');
    expect(() => bot(fakeAgent())).toThrow(
      /VITE_MOD_API_URL.*VITE_MOD_BOT_DID/,
    );
  });

  it('signs for the bot, and reuses the token until it is nearly out', async () => {
    const { hubOverview } = await withBot();
    const { fetch, sent } = fakeFetch({
      'GET /api/me': { tier: 'owner', canWrite: true },
      'GET /api/lists': {
        multi: false,
        lists: [{ rkey: 'main', name: 'Block List', n: 3 }],
      },
      'GET /api/overview': {
        list: { total: 3 },
        waiting: { queue: 1 },
        week: { added: 2 },
      },
    });
    vi.stubGlobal('fetch', fetch);
    const agent = fakeAgent();
    const o = await hubOverview(agent);
    await hubOverview(agent);
    expect(o).toMatchObject({ queue: { total: 1 }, listInfo: { count: 3 } });
    expect(agent.com.atproto.server.getServiceAuth).toHaveBeenCalledTimes(1);
    // No method: the bot takes a token that names none.
    expect(agent.com.atproto.server.getServiceAuth).toHaveBeenCalledWith({
      aud: BOT,
    });
    expect(
      sent.every((s) => s.headers.Authorization?.startsWith('Bearer x.')),
    ).toBe(true);
  });

  it('removes and restores with the bot’s own commands, naming the main list when there are several', async () => {
    const { queueDecide } = await withBot();
    const { fetch, sent } = fakeFetch({
      'POST /api/command': {
        ok: true,
        outcome: 'done',
        text: 'Done.',
        options: [],
        choice: false,
      },
      'POST /api/queue/keep': { ok: true },
    });
    vi.stubGlobal('fetch', fetch);
    const agent = fakeAgent();
    await queueDecide(agent, {
      did: 'did:plc:x',
      decision: 'remove',
      band: 'CONNECTED',
    });
    await queueDecide(agent, {
      did: 'did:plc:x',
      decision: 'restore',
      list: 'main',
      lists: { multi: true, lists: [{ rkey: 'main' }, { rkey: 'spam' }] },
    });
    await queueDecide(agent, {
      did: 'did:plc:x',
      decision: 'keep',
      band: 'CONNECTED',
    });
    expect(sent.map((s) => s.body)).toEqual([
      { command: 'unblock did:plc:x' },
      { command: 'block did:plc:x list:main' },
      { did: 'did:plc:x', band: 'CONNECTED' },
    ]);
  });

  it('shows the bot’s words when a command did nothing', async () => {
    const { runCommand } = await withBot();
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        'POST /api/command': {
          ok: true,
          outcome: null,
          text: 'They are PROTECTED. I added nobody.',
          options: [],
        },
      }).fetch,
    );
    await expect(
      runCommand(fakeAgent(), 'block did:plc:friend'),
    ).rejects.toThrow(/PROTECTED/);
  });

  it('filters and pages a plan here, from the rows the bot sent once', async () => {
    const { planDetail } = await withBot();
    const rows = [
      {
        did: 'did:plc:a',
        band: 'UNKNOWN',
        label: 'hostile',
        added: false,
        listed: false,
      },
      {
        did: 'did:plc:b',
        band: 'CONNECTED',
        label: 'arguing',
        added: false,
        listed: false,
        vouches: 4,
      },
      {
        did: 'did:plc:c',
        band: 'UNKNOWN',
        label: 'hostile',
        added: true,
        listed: false,
      },
      {
        did: 'did:plc:d',
        band: 'UNKNOWN',
        label: null,
        added: false,
        listed: true,
      },
    ];
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        'GET /api/scan': {
          code: 'abcd1234',
          scan: true,
          uri: 'at://did:plc:author/app.bsky.feed.post/3abc',
          total: 4,
          live: 1,
          labels: { hostile: 2, arguing: 1, neutral: 0 },
          words: [],
          rows,
        },
        'POST /api/profiles': { profiles: {} },
      }).fetch,
    );
    const agent = fakeAgent();
    const pending = await planDetail(agent, {
      code: 'abcd1234',
      state: 'pending',
    });
    expect(pending.rows.map((r) => r.did)).toEqual(['did:plc:b', 'did:plc:a']);
    const hostile = await planDetail(agent, {
      code: 'abcd1234',
      state: 'all',
      label: 'hostile',
    });
    expect(hostile.matched).toBe(2);
    expect(pending.webUrl).toBe(
      'https://bsky.app/profile/did:plc:author/post/3abc',
    );
    expect(pending.counts).toMatchObject({ total: 4, added: 1, labelled: 3 });
  });
});

describe('the site’s own graph lists', () => {
  it('sign for this site, not the bot', async () => {
    const { graphLists } = await withBot();
    const { fetch, sent } = fakeFetch({
      'POST /api/graph-lists': { lists: [] },
    });
    vi.stubGlobal('fetch', fetch);
    const agent = fakeAgent();
    await graphLists(agent, { action: 'preview' });
    expect(agent.com.atproto.server.getServiceAuth).toHaveBeenCalledWith(
      expect.objectContaining({ lxm: 'is.dame.graph.lists' }),
    );
    expect(
      agent.com.atproto.server.getServiceAuth.mock.calls[0][0].aud,
    ).not.toBe(BOT);
    expect(sent[0]).toMatchObject({
      path: '/api/graph-lists',
      body: { action: 'preview' },
    });
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

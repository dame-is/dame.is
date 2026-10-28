// The are.na proxy holds the owner's account token, so these are the ways it
// could be made to lend it: a path that escapes /channels/, and a slug the
// site doesn't publish.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const HOST = 'dame.is';
const PUBLISHED = 'red-blue-yellow';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.end = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

/** The deployment's curating snapshot, and are.na echoing who asked. */
function stubFetch() {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization || null });
    if (String(url) === `https://${HOST}/data/curating.json`) {
      return Response.json({
        galleries: [{ slug: 'rbw', arenaSlug: PUBLISHED }],
      });
    }
    if (String(url).startsWith('https://api.are.na/'))
      return Response.json({ ok: true });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

// A fresh module per test: the published-slug list is cached for the life of
// an instance, and each case wants to see it read.
let handler;
let channelSlugFromPath;
beforeEach(async () => {
  vi.resetModules();
  ({ default: handler, channelSlugFromPath } = await import('./arena.js'));
  vi.stubEnv('ARENA_ACCESS_TOKEN', 'secret-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const call = async (path, headers = {}) => {
  const res = mockRes();
  await handler({ query: { path }, headers: { host: HOST, ...headers } }, res);
  return res;
};

describe('channelSlugFromPath', () => {
  it('accepts exactly the two shapes the site sends', () => {
    expect(channelSlugFromPath(`/channels/${PUBLISHED}`)).toBe(PUBLISHED);
    expect(
      channelSlugFromPath(
        `/channels/${PUBLISHED}/contents?page=2&per=100&sort=position_asc`,
      ),
    ).toBe(PUBLISHED);
  });

  it('refuses every way out of /channels/', () => {
    for (const path of [
      '/channels/%2e%2e/me',
      '/channels/%2E%2e/%2e%2e/v2/me',
      '/channels/x/../me',
      '/channels/../me',
      '/channels/x/contents?page=1&per=10&sort=position_asc&extra=1',
      '/channels/x/collaborators',
      '/channels/x\\..\\me',
      '/channels/',
      '/me',
      undefined,
    ]) {
      expect(channelSlugFromPath(path), String(path)).toBeNull();
    }
  });
});

describe('/api/arena', () => {
  it('400s an encoded traversal without calling are.na', async () => {
    const calls = stubFetch();
    // The query string is already decoded once by the time it arrives here.
    const res = await call('/channels/%2e%2e/me');
    expect(res.statusCode).toBe(400);
    expect(
      calls.filter((c) => c.url.startsWith('https://api.are.na/')),
    ).toHaveLength(0);
  });

  it('lends the token for a gallery the site publishes', async () => {
    const calls = stubFetch();
    const res = await call(`/channels/${PUBLISHED}`);
    expect(res.statusCode).toBe(200);
    const upstream = calls.find((c) => c.url.startsWith('https://api.are.na/'));
    expect(upstream.url).toBe(`https://api.are.na/v3/channels/${PUBLISHED}`);
    expect(upstream.auth).toBe('Bearer secret-token');
  });

  it('asks as a guest for any other channel', async () => {
    const calls = stubFetch();
    const res = await call(
      '/channels/somebody-elses-private-channel/contents?page=1&per=10&sort=position_asc',
    );
    expect(res.statusCode).toBe(200);
    expect(
      calls.find((c) => c.url.startsWith('https://api.are.na/')).auth,
    ).toBeNull();
  });

  it('reads the snapshot once for requests that arrive together', async () => {
    const calls = stubFetch();
    await Promise.all([
      call(`/channels/${PUBLISHED}`),
      call(`/channels/${PUBLISHED}/contents?page=1&per=100&sort=position_asc`),
    ]);
    const upstream = calls.filter((c) =>
      c.url.startsWith('https://api.are.na/'),
    );
    expect(upstream.map((c) => c.auth)).toEqual([
      'Bearer secret-token',
      'Bearer secret-token',
    ]);
    expect(calls.filter((c) => c.url.endsWith('/curating.json'))).toHaveLength(
      1,
    );
  });

  it('asks as a guest when the snapshot cannot be read', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        calls.push({
          url: String(url),
          auth: init.headers?.Authorization || null,
        });
        if (String(url).startsWith('https://api.are.na/'))
          return Response.json({});
        return new Response('down', { status: 500 });
      }),
    );
    await call(`/channels/${PUBLISHED}`);
    expect(
      calls.find((c) => c.url.startsWith('https://api.are.na/')).auth,
    ).toBeNull();
  });

  it('refuses a page on another site', async () => {
    stubFetch();
    const res = await call(`/channels/${PUBLISHED}`, {
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
  });
});

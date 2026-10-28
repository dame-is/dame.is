import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createSubjectResolver } from './subjectResolver.js';

// Each test builds its own resolver, so only atproto.js's PLC cache is shared
// between them — hence a DID per test wherever a PDS gets resolved.

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code) => ({
  ok: false,
  status: code,
  statusText: String(code),
  text: async () => '',
  json: async () => ({}),
});

const post = (uri) => ({
  uri,
  cid: 'bafy',
  author: { did: 'did:plc:x', handle: 'x.test' },
  record: { text: 'hi' },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('resolveBskyPosts', () => {
  const URI = 'at://did:plc:x/app.bsky.feed.post/3abc';

  it('asks again after a failed batch instead of remembering it as missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(json({ posts: [post(URI)] }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = createSubjectResolver();

    expect((await resolver.resolveBskyPosts([URI])).get(URI)).toBeNull();
    // Rested for a minute — the next rebuild doesn't hammer a failing AppView…
    expect((await resolver.resolveBskyPosts([URI])).get(URI)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // …and after that it gets its answer.
    vi.advanceTimersByTime(61_000);
    expect((await resolver.resolveBskyPosts([URI])).get(URI)?.uri).toBe(URI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a post the AppView answered without as missing', async () => {
    const fetchMock = vi.fn(async () => json({ posts: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const resolver = createSubjectResolver();

    expect((await resolver.resolveBskyPosts([URI])).get(URI)).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect((await resolver.resolveBskyPosts([URI])).get(URI)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBskyProfiles', () => {
  it('asks again after a failed batch', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(
        json({ profiles: [{ did: 'did:plc:p', handle: 'p.test' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const resolver = createSubjectResolver();

    expect(
      (await resolver.resolveBskyProfiles(['did:plc:p'])).get('did:plc:p'),
    ).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(
      (await resolver.resolveBskyProfiles(['did:plc:p'])).get('did:plc:p')
        ?.handle,
    ).toBe('p.test');
  });
});

describe('resolveAtUris', () => {
  const plc = (did) =>
    json({
      service: [
        { id: '#atproto_pds', serviceEndpoint: `https://${did.slice(8)}.pds` },
      ],
    });

  it('keeps a RecordNotFound, but retries a record its PDS failed to serve', async () => {
    const did = 'did:plc:recordsflaky';
    const gone = `at://${did}/social.grain.gallery/gone`;
    const flaky = `at://${did}/social.grain.gallery/flaky`;
    let flakyCalls = 0;
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('https://plc.directory/')) return plc(did);
      if (u.includes('rkey=gone')) return status(400);
      flakyCalls += 1;
      return flakyCalls === 1
        ? status(502)
        : json({ uri: flaky, value: { title: 'ok' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const resolver = createSubjectResolver();

    const first = await resolver.resolveAtUris([gone, flaky]);
    expect(first.get(gone)).toBeNull();
    expect(first.get(flaky)).toBeNull();

    vi.advanceTimersByTime(61_000);
    const second = await resolver.resolveAtUris([gone, flaky]);
    expect(second.get(gone)).toBeNull();
    expect(second.get(flaky)?.value.title).toBe('ok');
    const goneCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes('rkey=gone'),
    );
    expect(goneCalls).toHaveLength(1);
  });

  it("doesn't black out a DID whose PDS lookup failed once", async () => {
    const did = 'did:plc:plcflaky';
    const uri = `at://${did}/sh.tangled.repo/r1`;
    let plcCalls = 0;
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('https://plc.directory/')) {
        plcCalls += 1;
        return plcCalls === 1 ? status(500) : plc(did);
      }
      return json({ uri, value: { name: 'repo' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const resolver = createSubjectResolver();

    expect((await resolver.resolveAtUris([uri])).get(uri)).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect((await resolver.resolveAtUris([uri])).get(uri)?.value.name).toBe(
      'repo',
    );
  });
});

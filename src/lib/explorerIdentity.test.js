import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./atproto.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveHandle: vi.fn(),
    resolvePds: vi.fn(),
    describeRepo: vi.fn(),
  };
});

const atproto = await import('./atproto.js');
const {
  clearRepoIdentityCache,
  explainExplorerError,
  explorerSearchPath,
  peekRepoIdentity,
  resolveRepoIdentity,
} = await import('./explorerIdentity.js');

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const PDS = 'https://pds.example';

beforeEach(() => {
  clearRepoIdentityCache();
  atproto.resolveHandle.mockResolvedValue(DID);
  atproto.resolvePds.mockResolvedValue(PDS);
  atproto.describeRepo.mockResolvedValue({
    did: DID,
    handle: 'dame.is',
    handleIsCorrect: true,
    collections: ['is.dame.now', 'app.bsky.feed.post'],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveRepoIdentity', () => {
  it('resolves a handle to did, handle, pds and sorted collections', async () => {
    const identity = await resolveRepoIdentity('dame.is');
    expect(identity).toEqual({
      did: DID,
      handle: 'dame.is',
      claimedHandle: 'dame.is',
      pds: PDS,
      collections: ['app.bsky.feed.post', 'is.dame.now'],
    });
  });

  it('remembers a repo by handle (any case, with or without @) and by DID', async () => {
    await resolveRepoIdentity('dame.is');
    expect(peekRepoIdentity('Dame.Is')?.did).toBe(DID);
    expect(peekRepoIdentity('@dame.is')?.did).toBe(DID);
    expect(peekRepoIdentity(DID)?.handle).toBe('dame.is');
    await resolveRepoIdentity(DID);
    expect(atproto.resolvePds).toHaveBeenCalledTimes(1);
    expect(atproto.describeRepo).toHaveBeenCalledTimes(1);
  });

  it('shares one request chain between concurrent lookups', async () => {
    await Promise.all([
      resolveRepoIdentity('dame.is'),
      resolveRepoIdentity('dame.is'),
    ]);
    expect(atproto.resolveHandle).toHaveBeenCalledTimes(1);
  });

  it('forgets a repo once the cache entry is stale', async () => {
    vi.useFakeTimers();
    try {
      await resolveRepoIdentity('dame.is');
      vi.advanceTimersByTime(6 * 60_000);
      expect(peekRepoIdentity('dame.is')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not trust a handle the repo claims but that fails to resolve back', async () => {
    atproto.describeRepo.mockResolvedValue({
      did: DID,
      handle: 'stale.example',
      handleIsCorrect: false,
      collections: [],
    });
    const identity = await resolveRepoIdentity(DID);
    expect(identity.handle).toBeNull();
    expect(identity.claimedHandle).toBe('stale.example');
  });

  it('still resolves when describeRepo fails, without collections', async () => {
    atproto.describeRepo.mockRejectedValue(new Error('HTTP 500'));
    const identity = await resolveRepoIdentity(DID);
    expect(identity).toMatchObject({
      did: DID,
      handle: null,
      collections: null,
    });
  });

  it('does not cache a failure', async () => {
    atproto.resolveHandle.mockResolvedValueOnce(null);
    await expect(resolveRepoIdentity('nobody.example')).rejects.toThrow(
      /resolve handle/,
    );
    expect(peekRepoIdentity('nobody.example')).toBeNull();
  });
});

describe('explorerSearchPath', () => {
  it('routes handles and DIDs to the repo', () => {
    expect(explorerSearchPath('dame.is')).toBe('/exploring/dame.is');
    expect(explorerSearchPath('  @dame.is ')).toBe('/exploring/dame.is');
    expect(explorerSearchPath(DID)).toBe(`/exploring/${DID}`);
  });

  it('routes at:// URIs at every depth', () => {
    expect(explorerSearchPath('at://dame.is')).toBe('/exploring/dame.is');
    expect(explorerSearchPath('at://dame.is/')).toBe('/exploring/dame.is');
    expect(explorerSearchPath(`at://${DID}/app.bsky.feed.post`)).toBe(
      `/exploring/${DID}/app.bsky.feed.post`,
    );
    expect(explorerSearchPath(`at://${DID}/app.bsky.feed.post/3abc`)).toBe(
      `/exploring/${DID}/app.bsky.feed.post/3abc`,
    );
  });

  it('returns null for input that names nothing', () => {
    expect(explorerSearchPath('')).toBeNull();
    expect(explorerSearchPath('   ')).toBeNull();
    expect(explorerSearchPath('at://')).toBeNull();
    expect(explorerSearchPath('@')).toBeNull();
  });
});

describe('explainExplorerError', () => {
  const httpError = (status, message) =>
    Object.assign(new Error(message), { status });

  it('says which repo could not be found, keeping the raw text as detail', () => {
    const err = httpError(
      400,
      'HTTP 400 Bad Request for https://bsky.social/xrpc/… :: {}',
    );
    expect(
      explainExplorerError(err, { kind: 'repo', subject: 'nobody.example' }),
    ).toEqual({
      message: 'Couldn’t find a repo for “nobody.example”.',
      detail: err.message,
    });
    expect(
      explainExplorerError(new Error('Could not resolve handle x'), {
        kind: 'repo',
      }).message,
    ).toBe('Couldn’t find that repo.');
  });

  it('describes a missing record and an unlistable collection', () => {
    expect(
      explainExplorerError(httpError(400, 'x'), { kind: 'record' }).message,
    ).toMatch(/no record at this address/);
    expect(
      explainExplorerError(httpError(400, 'x'), {
        kind: 'collection',
        subject: 'a.b.c',
      }).message,
    ).toBe('Couldn’t list “a.b.c” on this repo.');
  });

  it('tells a server failure from a network one', () => {
    expect(explainExplorerError(httpError(502, 'x')).message).toMatch(
      /server had a problem/,
    );
    const offline = new TypeError('Failed to fetch');
    expect(explainExplorerError(offline).message).toMatch(
      /Couldn’t reach the server/,
    );
  });
});

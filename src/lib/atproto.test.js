import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  didWebDocumentUrl,
  fetchWithTimeout,
  getPlcDocument,
  getRepoRev,
  isRecordNotFound,
  listRecords,
  resolvePds,
} from './atproto.js';

// The module's caches live for the process, so every test asks about a DID of
// its own.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const plcDoc = (pds) => ({
  service: [{ id: '#atproto_pds', serviceEndpoint: pds }],
});

describe('getPlcDocument', () => {
  it('sends concurrent lookups for one DID as a single request', async () => {
    const fetchMock = vi.fn(async () => json(plcDoc('https://pds.example/')));
    vi.stubGlobal('fetch', fetchMock);

    const pds = await Promise.all([
      resolvePds('did:plc:concurrent'),
      resolvePds('did:plc:concurrent'),
      resolvePds('did:plc:concurrent'),
      resolvePds('did:plc:concurrent'),
    ]);
    expect(pds).toEqual(Array(4).fill('https://pds.example'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed lookup: the next caller asks again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
        text: async () => '',
      })
      .mockResolvedValueOnce(json(plcDoc('https://pds.example')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPlcDocument('did:plc:flaky')).rejects.toThrow(/503/);
    await expect(resolvePds('did:plc:flaky')).resolves.toBe(
      'https://pds.example',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an answer for minutes, not seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = vi.fn(async () => json(plcDoc('https://pds.example')));
    vi.stubGlobal('fetch', fetchMock);

    await resolvePds('did:plc:held');
    vi.advanceTimersByTime(5 * 60_000);
    await resolvePds('did:plc:held');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60_000);
    await resolvePds('did:plc:held');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('did:web', () => {
  it('reads the document from the host named in the DID', async () => {
    const fetchMock = vi.fn(async () =>
      json(plcDoc('https://pds.web.example')),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePds('did:web:web.example')).resolves.toBe(
      'https://pds.web.example',
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://web.example/.well-known/did.json',
    );
  });

  it('decodes a port and refuses a path', () => {
    expect(didWebDocumentUrl('did:web:localhost%3A2583')).toBe(
      'https://localhost:2583/.well-known/did.json',
    );
    expect(didWebDocumentUrl('did:web:example.com:user:alice')).toBeNull();
    expect(didWebDocumentUrl('did:web:exa mple.com')).toBeNull();
    expect(didWebDocumentUrl('did:plc:abc')).toBeNull();
  });
});

describe('listRecords', () => {
  it('stops at a short page instead of following its cursor to an empty one', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        records: [{ uri: 'at://a/c/1' }, { uri: 'at://a/c/2' }],
        cursor: '2',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const records = await listRecords('https://pds.example', {
      repo: 'did:plc:a',
      collection: 'c',
    });
    expect(records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps paging while pages come back full', async () => {
    const page = (n, cursor) =>
      json({ records: Array.from({ length: n }, (_, i) => ({ i })), cursor });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(2, 'a'))
      .mockResolvedValueOnce(page(2, 'b'))
      .mockResolvedValueOnce(page(1, 'c'));
    vi.stubGlobal('fetch', fetchMock);

    const records = await listRecords('https://pds.example', {
      repo: 'did:plc:a',
      collection: 'c',
      limit: 2,
      max: 10,
    });
    expect(records).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('getRepoRev', () => {
  it('serves every reader on one tick from one getLatestCommit', async () => {
    const fetchMock = vi.fn(async (url) =>
      String(url).includes('getLatestCommit')
        ? json({ cid: 'bafy', rev: '3rev' })
        : json(plcDoc('https://pds.example')),
    );
    vi.stubGlobal('fetch', fetchMock);

    const revs = await Promise.all([
      getRepoRev('did:plc:ticking'),
      getRepoRev('did:plc:ticking'),
      getRepoRev('did:plc:ticking'),
    ]);
    expect(revs).toEqual(['3rev', '3rev', '3rev']);
    const commits = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes('getLatestCommit'),
    );
    expect(commits).toHaveLength(1);
  });
});

describe('fetchWithTimeout', () => {
  // A fetch that only ever ends by being aborted, the way a stalled server
  // behaves.
  const hanging = () =>
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(init.signal.reason),
          );
        }),
    );

  it('gives up on a server that stops answering', async () => {
    vi.stubGlobal('fetch', hanging());
    await expect(
      fetchWithTimeout('https://stalled.example', {}, 20),
    ).rejects.toBeTruthy();
  });

  it('keeps a caller signal working alongside its own', async () => {
    vi.stubGlobal('fetch', hanging());
    const controller = new AbortController();
    const pending = fetchWithTimeout('https://stalled.example', {
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('still times out when the caller passed a signal of its own', async () => {
    vi.stubGlobal('fetch', hanging());
    const controller = new AbortController();
    await expect(
      fetchWithTimeout(
        'https://stalled.example',
        { signal: controller.signal },
        20,
      ),
    ).rejects.toBeTruthy();
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('isRecordNotFound', () => {
  it('reads a PDS RecordNotFound as the record being gone', () => {
    expect(
      isRecordNotFound({ status: 400, message: 'HTTP 400 :: RecordNotFound' }),
    ).toBe(true);
    expect(isRecordNotFound({ status: 404 })).toBe(true);
    expect(isRecordNotFound(new Error('Could not locate record'))).toBe(true);
    // As @atproto/api throws it: the XRPC code, and a message that may not say.
    expect(
      isRecordNotFound(
        Object.assign(new Error('Not here'), { error: 'RecordNotFound' }),
      ),
    ).toBe(true);
  });

  it('says nothing about the record when the server could not be asked', () => {
    expect(isRecordNotFound({ status: 503 })).toBe(false);
    expect(isRecordNotFound({ status: 429 })).toBe(false);
    expect(
      isRecordNotFound(new Error('The operation was aborted due to timeout')),
    ).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });
});

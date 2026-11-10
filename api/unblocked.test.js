// The endpoint behind /experimenting/unblocking. It holds the service role
// key, so what matters is what it will and won't pass on: a DID and nothing
// else reaches Postgres, a failure says nothing about why, and only an answer
// is ever cached.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SIZE, LOOKUP_SIZE, QUICK_SECONDS } from '../src/lib/unblocking.js';

const rpc = vi.fn();
vi.mock('./_lib/unblockDb.js', () => ({ rpc: (...args) => rpc(...args) }));

const { default: handler } = await import('./unblocked.js');

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
  return res;
}

const call = async (query = {}, method = 'GET') => {
  const res = mockRes();
  await handler({ method, query, headers: {} }, res);
  return res;
};

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/unblocked', () => {
  it('answers with the ranking, and lets the CDN hold it', async () => {
    const board = { status: null, unblocks: 0, leaderboard: [] };
    rpc.mockResolvedValue(board);
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(board);
    expect(rpc).toHaveBeenCalledWith('board', { min_seconds: QUICK_SECONDS, max_rows: BOARD_SIZE });
    expect(res.headers['cache-control']).toContain('s-maxage=300');
  });

  it('answers for one account, held for less long', async () => {
    const lookup = { did: DID, total: 0, quick: 0, events: [] };
    rpc.mockResolvedValue(lookup);
    const res = await call({ did: ` ${DID} ` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(lookup);
    expect(rpc).toHaveBeenCalledWith('lookup', {
      who: DID,
      min_seconds: QUICK_SECONDS,
      max_rows: LOOKUP_SIZE,
    });
    expect(res.headers['cache-control']).toContain('s-maxage=60');
  });

  it('refuses anything that isn’t a DID before it reaches the database', async () => {
    for (const did of ['dame.is', 'did:', "did:plc:x' or 1=1", `did:web:${'a'.repeat(600)}`, 'at://did:plc:x']) {
      const res = await call({ did });
      expect(res.statusCode).toBe(400);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says only that the tracker can’t be reached, and caches nothing, when the database fails', async () => {
    rpc.mockRejectedValue(new Error('unblock db board failed: 406 Invalid schema: unblock. key=eyJsecret'));
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('schema');
    expect(JSON.stringify(res.body)).not.toContain('eyJ');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('only reads', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await call({}, method);
      expect(res.statusCode).toBe(405);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

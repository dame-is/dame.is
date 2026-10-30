import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createProfileAsker, PROFILE_RETRY_MS } from './profileAsker.js';

const profile = (did) => ({ handle: `${did.split(':').pop()}.test`, displayName: '', avatar: '' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createProfileAsker', () => {
  it('keeps an answer that lands after another ask has gone out', async () => {
    // The bug it replaces: each new row cancelled the answer still in flight
    // for the row before, and that row was never asked for again.
    const pending = [];
    const resolve = vi.fn((dids) => new Promise((r) => pending.push({ dids, r })));
    const found = {};
    const asker = createProfileAsker({ resolve, onFound: (p) => Object.assign(found, p) });

    asker.ask(['did:plc:a']);
    asker.ask(['did:plc:a', 'did:plc:b']);
    expect(resolve.mock.calls.map(([d]) => d)).toEqual([['did:plc:a'], ['did:plc:b']]);

    pending[1].r({ 'did:plc:b': profile('did:plc:b') });
    pending[0].r({ 'did:plc:a': profile('did:plc:a') });
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(found).sort()).toEqual(['did:plc:a', 'did:plc:b']);
    asker.close();
  });

  it('asks about each account once while it is answered or in flight', async () => {
    const resolve = vi.fn(async (dids) => Object.fromEntries(dids.map((d) => [d, profile(d)])));
    const asker = createProfileAsker({ resolve, onFound: () => {} });
    asker.ask(['did:plc:a', 'did:plc:a', '', null]);
    asker.ask(['did:plc:a']);
    await vi.advanceTimersByTimeAsync(0);
    asker.ask(['did:plc:a']);
    expect(resolve).toHaveBeenCalledTimes(1);
    asker.close();
  });

  it('asks again after a failed ask, further apart each time, then leaves it', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('offline');
    });
    const asker = createProfileAsker({ resolve, onFound: () => {} });
    asker.ask(['did:plc:gone']);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolve).toHaveBeenCalledTimes(1);

    let calls = 1;
    for (const wait of PROFILE_RETRY_MS) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(resolve).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      calls += 1;
      expect(resolve).toHaveBeenCalledTimes(calls);
    }
    // Out of tries: a deactivated account doesn't keep this going.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(resolve).toHaveBeenCalledTimes(1 + PROFILE_RETRY_MS.length);
    asker.close();
  });

  it('retries only the accounts an answer left out', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({ 'did:plc:a': profile('did:plc:a') })
      .mockResolvedValue({ 'did:plc:b': profile('did:plc:b') });
    const found = {};
    const asker = createProfileAsker({ resolve, onFound: (p) => Object.assign(found, p) });
    asker.ask(['did:plc:a', 'did:plc:b']);
    await vi.advanceTimersByTimeAsync(PROFILE_RETRY_MS[0]);
    expect(resolve.mock.calls.map(([d]) => d)).toEqual([['did:plc:a', 'did:plc:b'], ['did:plc:b']]);
    expect(Object.keys(found).sort()).toEqual(['did:plc:a', 'did:plc:b']);
    asker.close();
  });

  it('drops a late answer and any waiting retry once closed', async () => {
    let answer;
    const resolve = vi.fn(() => new Promise((r) => (answer = r)));
    const onFound = vi.fn();
    const asker = createProfileAsker({ resolve, onFound });
    asker.ask(['did:plc:a']);
    asker.close();
    answer({ 'did:plc:a': profile('did:plc:a') });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onFound).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

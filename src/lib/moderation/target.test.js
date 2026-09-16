import { describe, it, expect, vi } from 'vitest';
import {
  resolveTarget,
  looksLikeTarget,
  extractTargets,
  TargetError,
} from './target.js';

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const RKEY = '3mvngrgxmzs2t';

describe('resolveTarget', () => {
  it('passes an at:// URI straight through', async () => {
    const uri = `at://${DID}/app.bsky.feed.post/${RKEY}`;
    await expect(resolveTarget(uri)).resolves.toEqual({
      uri,
      did: DID,
      collection: 'app.bsky.feed.post',
      rkey: RKEY,
    });
  });

  it('takes a DID-form web link without touching the network', async () => {
    const fetchImpl = vi.fn();
    const out = await resolveTarget(
      `https://bsky.app/profile/${DID}/post/${RKEY}`,
      { fetchImpl },
    );
    expect(out.uri).toBe(`at://${DID}/app.bsky.feed.post/${RKEY}`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('matches on path, so a client fork nobody has heard of still works', async () => {
    const hosts = [
      'https://deer.social',
      'https://zeppelin.social',
      'https://some-fork-shipped-this-morning.example',
    ];
    for (const host of hosts) {
      const out = await resolveTarget(`${host}/profile/${DID}/post/${RKEY}`);
      expect(out.rkey).toBe(RKEY);
    }
  });

  it('resolves a handle-form link to a DID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ did: DID }),
    });
    const out = await resolveTarget(
      'https://bsky.app/profile/dame.is/post/abc',
      {
        fetchImpl,
      },
    );
    expect(out.did).toBe(DID);
    expect(fetchImpl.mock.calls[0][0]).toContain(
      'resolveHandle?handle=dame.is',
    );
  });

  it('throws a TargetError on a handle that will not resolve', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(
      resolveTarget('https://bsky.app/profile/nope.invalid/post/abc', {
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(TargetError);
  });

  it('ignores query strings and fragments after the rkey', async () => {
    const out = await resolveTarget(
      `https://bsky.app/profile/${DID}/post/${RKEY}?ref=share#top`,
    );
    expect(out.rkey).toBe(RKEY);
  });

  it('rejects a link that names a profile but no post', async () => {
    await expect(
      resolveTarget(`https://bsky.app/profile/${DID}`),
    ).rejects.toBeInstanceOf(TargetError);
  });

  it('rejects empty input', async () => {
    await expect(resolveTarget('   ')).rejects.toBeInstanceOf(TargetError);
  });
});

describe('looksLikeTarget', () => {
  it('is true for both accepted shapes and false for prose', () => {
    expect(looksLikeTarget(`at://${DID}/app.bsky.feed.post/${RKEY}`)).toBe(
      true,
    );
    expect(looksLikeTarget(`https://bsky.app/profile/x/post/${RKEY}`)).toBe(
      true,
    );
    expect(looksLikeTarget('block everyone in this thread')).toBe(false);
    expect(looksLikeTarget(null)).toBe(false);
  });
});

describe('extractTargets', () => {
  it('finds a link inside a sentence and strips trailing punctuation', () => {
    const msg = `what is going on with https://bsky.app/profile/${DID}/post/${RKEY}, is that a pile-on?`;
    expect(extractTargets(msg)).toEqual([
      `https://bsky.app/profile/${DID}/post/${RKEY}`,
    ]);
  });

  it('deduplicates and preserves order across several links', () => {
    const a = `at://${DID}/app.bsky.feed.post/aaa`;
    const b = `at://${DID}/app.bsky.feed.post/bbb`;
    expect(extractTargets(`${a} then ${b} then ${a}`)).toEqual([a, b]);
  });

  it('returns an empty list for a message with no links', () => {
    expect(extractTargets('mute that person please')).toEqual([]);
  });
});

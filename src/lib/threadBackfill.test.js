import { describe, it, expect } from 'vitest';
import { selfAncestorsFromThread } from './threadBackfill.js';
import { groupSelfReplyThreads } from './threadGrouping.js';

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';
const uri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;

// A `postView` as app.bsky.feed.getPostThread returns it.
function view(did, rkey, createdAt, parentRkey = null, parentDid = did) {
  return {
    uri: uri(did, rkey),
    cid: `cid-${rkey}`,
    author: { did, handle: did === ME ? 'me.test' : 'other.test' },
    record: {
      text: `post ${rkey}`,
      createdAt,
      ...(parentRkey
        ? { reply: { parent: { uri: uri(parentDid, parentRkey) }, root: { uri: uri(parentDid, parentRkey) } } }
        : {}),
    },
    likeCount: 1,
    replyCount: 1,
  };
}

describe('selfAncestorsFromThread', () => {
  it('walks up through my posts and stops at someone else’s', () => {
    // other:o ← me:a ← me:b, fetched as the thread of b.
    const node = {
      post: view(ME, 'b', '2020-01-01T00:02:00Z', 'a'),
      parent: {
        post: view(ME, 'a', '2020-01-01T00:01:00Z', 'o', OTHER),
        parent: { post: view(OTHER, 'o', '2020-01-01T00:00:00Z') },
      },
    };
    const items = selfAncestorsFromThread(node, ME);
    expect(items.map((i) => i.atUri)).toEqual([uri(ME, 'b'), uri(ME, 'a')]);
    expect(items[0]).toMatchObject({ verb: 'posting', createdAt: '2020-01-01T00:02:00Z' });
    // Each carries its parent's author, so the feed can tell which replies
    // continue a thread of mine and which answer someone else.
    expect(items[0].payload.parent.author.did).toBe(ME);
    expect(items[1].payload.parent.author.did).toBe(OTHER);
  });

  it('turns out feed items that thread with the loaded post they answer', () => {
    const loaded = {
      verb: 'posting',
      atUri: uri(ME, 'c'),
      createdAt: '2020-01-01T00:03:00Z',
      payload: { reply: { parent: { uri: uri(ME, 'b') } }, parent: { author: { did: ME } } },
    };
    const node = {
      post: view(ME, 'b', '2020-01-01T00:02:00Z', 'a'),
      parent: { post: view(ME, 'a', '2020-01-01T00:01:00Z') },
    };
    const out = groupSelfReplyThreads([loaded, ...selfAncestorsFromThread(node, ME)], ME);
    expect(out.map((i) => i.atUri)).toEqual([uri(ME, 'a'), uri(ME, 'b'), uri(ME, 'c')]);
    expect(out.every((i) => i._thread?.length === 3)).toBe(true);
  });

  it('returns nothing for a post that is gone or someone else’s', () => {
    expect(selfAncestorsFromThread({ $type: 'app.bsky.feed.defs#notFoundPost' }, ME)).toEqual([]);
    expect(selfAncestorsFromThread({ post: view(OTHER, 'o', 'x') }, ME)).toEqual([]);
    expect(selfAncestorsFromThread(null, ME)).toEqual([]);
  });
});

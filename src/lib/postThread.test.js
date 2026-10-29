import { describe, it, expect, vi } from 'vitest';
import {
  REPLY_DEPTH,
  PARENT_HEIGHT,
  selfChainAbove,
  walkSelfChain,
  extendSelfChain,
  repliesCutOff,
  chainFromAncestors,
  loadPostThread,
  conversationLikes,
  mostLikedFirst,
  withRepliesOldestFirst,
  repliesByPost,
  linearRun,
  postExcerpt,
} from './postThread.js';

const DAME = 'did:plc:dame';
const ELI = 'did:plc:eli';
const POE = 'did:plc:poe';

let clock = Date.parse('2026-10-29T21:00:00Z');

// A `postView` as app.bsky.feed.getPostThread returns it.
function post(
  rkey,
  did = DAME,
  { likes = 0, replyCount = 0, text = rkey, at = null, embed = null } = {},
) {
  clock += 60_000;
  return {
    uri: `at://${did}/app.bsky.feed.post/${rkey}`,
    author: { did, handle: did.split(':').pop() },
    record: { text, createdAt: at || new Date(clock).toISOString() },
    likeCount: likes,
    replyCount,
    ...(embed ? { embed } : {}),
  };
}

const node = (p, replies) => ({
  $type: 'app.bsky.feed.defs#threadViewPost',
  post: p,
  ...(replies ? { replies } : {}),
});

/** Link each node's `.parent` the way a view of the last one has them. */
function ancestry(...posts) {
  let parent = null;
  let n = null;
  for (const p of posts) {
    n = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: p,
      ...(parent ? { parent } : {}),
    };
    parent = n;
  }
  return n;
}

describe('selfChainAbove', () => {
  it('walks up through the author’s own posts and stops at anyone else’s', () => {
    const p0 = post('eli0', ELI);
    const [p1, p2, p3] = [post('d1'), post('d2'), post('d3')];
    const linked = ancestry(p0, p1, p2, p3);
    const { head, path } = selfChainAbove(linked, DAME);
    expect(head.post.uri).toBe(p1.uri);
    expect(head.parent.post.uri).toBe(p0.uri);
    expect(path).toEqual([p1.uri, p2.uri, p3.uri]);
  });

  it('is the post itself when it starts the chain', () => {
    const linked = ancestry(post('d1'));
    const { head, path } = selfChainAbove(linked, DAME);
    expect(head).toBe(linked);
    expect(path).toEqual([linked.post.uri]);
  });
});

describe('walkSelfChain', () => {
  it('follows a single self-reply at each level and leaves other replies', () => {
    const d3 = node(post('d3'));
    const d2 = node(post('d2'), [node(post('eli', ELI)), d3]);
    const d1 = node(post('d1'), [d2]);
    expect(walkSelfChain(d1, DAME).map((n) => n.post.uri)).toEqual(
      [d1, d2, d3].map((n) => n.post.uri),
    );
  });

  it('stops where the author branched, past the path', () => {
    const d1 = node(post('d1'), [node(post('a')), node(post('b'))]);
    expect(walkSelfChain(d1, DAME)).toHaveLength(1);
  });

  it('follows the path through a branch, so the linked post stays in its chain', () => {
    const b = node(post('b'), [node(post('b2'))]);
    const d1 = node(post('d1'), [node(post('a')), b]);
    const chain = walkSelfChain(d1, DAME, [d1.post.uri, b.post.uri]);
    expect(chain.map((n) => n.post.uri)).toEqual([
      d1.post.uri,
      b.post.uri,
      b.replies[0].post.uri,
    ]);
  });
});

describe('extendSelfChain', () => {
  it('fetches the tail’s replies when the view stopped short, and walks on', async () => {
    const tail = node(post('d2', DAME, { replyCount: 1 }));
    const root = node(post('d1'), [tail]);
    const more = [node(post('d3'), [node(post('d4'))])];
    const fetchReplies = vi.fn(async () => more);
    const chain = await extendSelfChain(root, DAME, { fetchReplies });
    expect(fetchReplies).toHaveBeenCalledWith(tail.post.uri);
    expect(chain.map((n) => n.post.record.text)).toEqual([
      'd1',
      'd2',
      'd3',
      'd4',
    ]);
  });

  it('asks nothing when the view holds the whole chain', async () => {
    const root = node(post('d1'), [node(post('d2'), [])]);
    const fetchReplies = vi.fn();
    expect(await extendSelfChain(root, DAME, { fetchReplies })).toHaveLength(2);
    expect(fetchReplies).not.toHaveBeenCalled();
  });

  it('keeps the replies it fetched for a tail that really ends there', async () => {
    const tail = node(post('d2', DAME, { replyCount: 1 }));
    const root = node(post('d1'), [tail]);
    const replies = [node(post('eli', ELI))];
    const fetchReplies = vi.fn(async () => replies);
    const chain = await extendSelfChain(root, DAME, { fetchReplies });
    expect(chain).toHaveLength(2);
    expect(fetchReplies).toHaveBeenCalledTimes(1);
    expect(tail.replies).toBe(replies);
  });

  it('stops where it is when a fetch fails', async () => {
    const root = node(post('d1'), [node(post('d2', DAME, { replyCount: 3 }))]);
    const chain = await extendSelfChain(root, DAME, {
      fetchReplies: async () => {
        throw new Error('down');
      },
    });
    expect(chain).toHaveLength(2);
  });
});

describe('repliesCutOff', () => {
  it('reads a post with replies and none in the view as cut off', () => {
    expect(repliesCutOff(node(post('a', DAME, { replyCount: 2 })))).toBe(true);
    expect(
      repliesCutOff(
        node(post('a', DAME, { replyCount: 2 }), [node(post('b'))]),
      ),
    ).toBe(false);
    expect(repliesCutOff(node(post('a')))).toBe(false);
  });
});

describe('chainFromAncestors', () => {
  it('rebuilds the chain above a post from its parents', () => {
    const [p1, p2, p3] = [post('d1'), post('d2'), post('d3')];
    const linked = ancestry(post('eli', ELI), p1, p2, p3);
    const root = chainFromAncestors(linked, 2);
    expect(walkSelfChain(root, DAME).map((n) => n.post.uri)).toEqual([
      p1.uri,
      p2.uri,
      p3.uri,
    ]);
  });
});

describe('loadPostThread', () => {
  // Post 3 of a four-post thread, with replies on post 1.
  function thread() {
    const [p1, p2, p3, p4] = [post('d1'), post('d2'), post('d3'), post('d4')];
    const eli = post('eli', ELI, { likes: 4 });
    const linked = ancestry(p1, p2, p3);
    linked.replies = [node(p4)];
    const fromHead = node(p1, [node(eli), node(p2, [node(p3, [node(p4)])])]);
    return { p1, p3, linked, fromHead, eli };
  }

  it('fetches from the first post of the chain and marks the linked one', async () => {
    const { p1, p3, linked, fromHead, eli } = thread();
    const fetchThread = vi.fn(async (uri) => ({
      thread: uri === p3.uri ? linked : fromHead,
    }));
    const res = await loadPostThread(p3.uri, { fetchThread, authorDid: DAME });
    expect(fetchThread).toHaveBeenNthCalledWith(1, p3.uri, {
      depth: REPLY_DEPTH,
      parentHeight: PARENT_HEIGHT,
    });
    // Two posts above the linked one, so two more levels to reach it.
    expect(fetchThread).toHaveBeenNthCalledWith(2, p1.uri, {
      depth: 2 + REPLY_DEPTH,
      parentHeight: 0,
    });
    expect(res.chain.map((n) => n.post.record.text)).toEqual([
      'd1',
      'd2',
      'd3',
      'd4',
    ]);
    expect(res.linkedIndex).toBe(2);
    expect(res.groups[0].replies.map((n) => n.post.uri)).toEqual([eli.uri]);
    expect(res.above.post.uri).toBe(p1.uri);
  });

  it('makes one request for a post that starts its chain', async () => {
    const p1 = post('d1');
    const view = node(p1, [node(post('d2'))]);
    const fetchThread = vi.fn(async () => ({ thread: view }));
    const res = await loadPostThread(p1.uri, { fetchThread, authorDid: DAME });
    expect(fetchThread).toHaveBeenCalledTimes(1);
    expect(res.chain).toHaveLength(2);
    expect(res.linkedIndex).toBe(0);
  });

  it('falls back to the chain the parents describe when the first post can’t be fetched', async () => {
    const { p3, linked } = thread();
    const fetchThread = vi.fn(async (uri) => {
      if (uri === p3.uri) return { thread: linked };
      throw new Error('down');
    });
    const res = await loadPostThread(p3.uri, { fetchThread, authorDid: DAME });
    expect(res.chain.map((n) => n.post.record.text)).toEqual([
      'd1',
      'd2',
      'd3',
      'd4',
    ]);
    expect(res.linkedIndex).toBe(2);
    expect(res.groups[0].replies).toEqual([]);
  });

  it('is null for a post the AppView has no view of', async () => {
    expect(
      await loadPostThread('at://x/y/z', { fetchThread: async () => ({}) }),
    ).toBeNull();
  });
});

describe('ordering replies', () => {
  it('counts likes across a whole conversation', () => {
    const conv = node(post('a', ELI, { likes: 1 }), [
      node(post('b', POE, { likes: 5 }), [node(post('c', ELI, { likes: 2 }))]),
    ]);
    expect(conversationLikes(conv)).toBe(8);
  });

  it('puts the most-liked conversation first, and the earlier one on a tie', () => {
    const quiet = node(post('quiet', ELI, { likes: 1 }));
    const tieA = node(post('tieA', ELI, { likes: 3 }));
    const tieB = node(post('tieB', POE, { likes: 3 }));
    const busy = node(post('busy', POE, { likes: 0 }), [
      node(post('reply', ELI, { likes: 9 })),
    ]);
    expect(
      mostLikedFirst([quiet, tieB, busy, tieA]).map((n) => n.post.record.text),
    ).toEqual(['busy', 'tieA', 'tieB', 'quiet']);
  });

  it('reads within a conversation oldest first', () => {
    const late = node(post('late', POE, { at: '2026-10-29T22:00:00Z' }));
    const early = node(post('early', ELI, { at: '2026-10-29T21:30:00Z' }));
    const conv = node(post('top', ELI), [late, early]);
    expect(
      withRepliesOldestFirst(conv).replies.map((n) => n.post.record.text),
    ).toEqual(['early', 'late']);
    // A copy: the view it came from is left as it was.
    expect(conv.replies[0]).toBe(late);
  });
});

describe('repliesByPost', () => {
  it('files each reply under the post it answers, leaving out the chain carrying on', () => {
    const d2 = node(post('d2'), [node(post('on2', POE))]);
    const d1 = node(post('d1'), [node(post('on1', ELI)), d2]);
    const groups = repliesByPost([d1, d2]);
    expect(groups.map((g) => g.replies.map((n) => n.post.record.text))).toEqual(
      [['on1'], ['on2']],
    );
    expect(groups.map((g) => g.index)).toEqual([0, 1]);
  });

  it('keeps placeholders for deleted posts', () => {
    const gone = {
      $type: 'app.bsky.feed.defs#notFoundPost',
      uri: 'at://x/app.bsky.feed.post/gone',
    };
    const d1 = node(post('d1'), [gone]);
    expect(repliesByPost([d1])[0].replies).toEqual([gone]);
  });
});

describe('linearRun', () => {
  it('runs while each reply has exactly one reply', () => {
    const d = node(post('d', POE));
    const c = node(post('c', ELI), [d]);
    const b = node(post('b', POE), [c]);
    expect(linearRun(b).map((n) => n.post.record.text)).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('ends on a node that branches', () => {
    const b = node(post('b', POE), [
      node(post('x', ELI)),
      node(post('y', ELI)),
    ]);
    const a = node(post('a', ELI), [b]);
    expect(linearRun(a).map((n) => n.post.record.text)).toEqual(['a', 'b']);
  });
});

describe('postExcerpt', () => {
  it('cuts at a word and drops the object replacement character', () => {
    expect(postExcerpt({ record: { text: 'short and sweet￼' } })).toBe(
      'short and sweet',
    );
    expect(
      postExcerpt(
        {
          record: {
            text: 'not really a fan of this trend we’re seeing on the left where people are',
          },
        },
        40,
      ),
    ).toBe('not really a fan of this trend we’re…');
  });

  it('names a post without words by what it holds', () => {
    expect(
      postExcerpt({
        record: { text: '' },
        embed: { $type: 'app.bsky.embed.images#view' },
      }),
    ).toBe('a picture');
    expect(postExcerpt({ record: {} })).toBe('a post');
  });
});

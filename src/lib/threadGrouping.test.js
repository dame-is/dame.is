import { describe, it, expect } from 'vitest';
import {
  groupSelfReplyThreads,
  collapseSelfThreads,
  completeSelfThreads,
  isSelfThreadRow,
  missingSelfParents,
  threadEngagement,
  threadAwareDateKey,
  selfThreadMembers,
} from './threadGrouping.js';

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';

// Build a `posting` feed item. `parent` is the atUri of the post it replies to
// (omit for a standalone post); `parentDid` is the hydrated author of that
// parent (defaults to ME so it reads as a self-reply).
function post(rkey, createdAt, { parent = null, parentDid = ME } = {}) {
  const item = {
    verb: 'posting',
    atUri: `at://${ME}/app.bsky.feed.post/${rkey}`,
    createdAt,
    payload: {},
  };
  if (parent) {
    item.payload.reply = { parent: { uri: parent } };
    item.payload.parent = { author: { did: parentDid } };
  }
  return item;
}
const uri = (rkey) => `at://${ME}/app.bsky.feed.post/${rkey}`;

describe('groupSelfReplyThreads', () => {
  it('passes the input through untouched when it cannot form a thread', () => {
    const single = [post('a', '2020-01-01T00:00:00Z')];
    expect(groupSelfReplyThreads(single, ME)).toBe(single);
    // Missing myDid or non-arrays are returned as-is.
    const two = [post('a', '2020-01-01T00:00:00Z'), post('b', '2020-01-01T00:01:00Z')];
    expect(groupSelfReplyThreads(two, null)).toBe(two);
    expect(groupSelfReplyThreads(null, ME)).toBeNull();
  });

  it('reorders a self-reply chain oldest-first, anchored at the newest post', () => {
    // Feed arrives newest-first. X is an unrelated newer standalone post.
    const a = post('a', '2020-01-01T00:01:00Z'); // root of the thread
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
    const x = post('x', '2020-01-01T00:05:00Z');
    const out = groupSelfReplyThreads([x, c, b, a], ME);

    // X stays a passed-through singleton at the front; the thread expands into
    // chronological order at the position of its newest member (C).
    expect(out.map((i) => i.atUri)).toEqual([uri('x'), uri('a'), uri('b'), uri('c')]);
    expect(out[0]._thread).toBeUndefined();

    const [, ta, tb, tc] = out;
    expect(ta._thread).toMatchObject({
      length: 3,
      position: 0,
      isFirst: true,
      isLast: false,
      continuesPrev: false, // the root has no visible parent above it
      rootAtUri: uri('a'),
      anchorAt: c.createdAt, // day-grouping follows the newest post
    });
    expect(tb._thread).toMatchObject({ position: 1, continuesPrev: true });
    expect(tc._thread).toMatchObject({
      position: 2,
      isLast: true,
      continuesPrev: true,
      anchorAt: c.createdAt,
    });
    // Each post knows how many of its replies are the thread carrying on.
    expect([ta, tb, tc].map((t) => t._thread.selfReplies)).toEqual([1, 1, 0]);
  });

  it('counts every branch when Dame replies to one post twice', () => {
    const a = post('a', '2020-01-01T00:01:00Z');
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('a') });
    const out = groupSelfReplyThreads([c, b, a], ME);
    expect(out.map((i) => i._thread.selfReplies)).toEqual([2, 0, 0]);
  });

  it('does not group a reply whose parent is outside the feed window', () => {
    const orphan = post('r', '2020-01-01T00:02:00Z', { parent: uri('missing') });
    const other = post('s', '2020-01-01T00:05:00Z');
    const out = groupSelfReplyThreads([other, orphan], ME);
    expect(out.map((i) => i.atUri)).toEqual([uri('s'), uri('r')]);
    expect(out.every((i) => i._thread === undefined)).toBe(true);
  });

  it('does not group replies to other people', () => {
    const a = post('a', '2020-01-01T00:01:00Z');
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a'), parentDid: OTHER });
    const out = groupSelfReplyThreads([b, a], ME);
    expect(out.every((i) => i._thread === undefined)).toBe(true);
  });
});

describe('collapseSelfThreads', () => {
  it('folds a thread into one row that leads with its oldest post', () => {
    const a = post('a', '2020-01-01T00:01:00Z');
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
    const x = post('x', '2020-01-01T00:05:00Z');
    const y = post('y', '2020-01-01T00:00:00Z');
    const out = collapseSelfThreads(groupSelfReplyThreads([x, c, b, a, y], ME));

    expect(out.map((i) => i.atUri)).toEqual([uri('x'), uri('a'), uri('y')]);
    const row = out[1];
    expect(isSelfThreadRow(row)).toBe(true);
    expect(row._thread.posts.map((p) => p.atUri)).toEqual([uri('a'), uri('b'), uri('c')]);
    // The row still files under the newest post's day.
    expect(threadAwareDateKey(row)).toBe(c.createdAt);
    expect(isSelfThreadRow(out[0])).toBe(false);
  });

  it('passes a feed with no threads through as it was', () => {
    const items = [post('a', '2020-01-01T00:02:00Z'), post('b', '2020-01-01T00:01:00Z')];
    expect(collapseSelfThreads(items)).toEqual(items);
    expect(collapseSelfThreads(null)).toBeNull();
  });
});

describe('completeSelfThreads', () => {
  // Newest first, as a feed arrives: X is unrelated, A ← B ← C a thread.
  const a = post('a', '2020-01-01T00:01:00Z');
  const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
  const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
  const x = post('x', '2020-01-01T00:05:00Z');
  const y = post('y', '2020-01-01T00:00:00Z');
  const all = [x, c, b, a, y];

  it('brings the rest of a thread into a window that holds part of it', () => {
    // A window of two holds X and the thread's newest post; the thread's
    // older posts come along, and Y, in no thread, stays out.
    const out = completeSelfThreads(all.slice(0, 2), all, ME);
    expect(out.map((i) => i.atUri)).toEqual([uri('x'), uri('c'), uri('b'), uri('a')]);
  });

  it('brings a whole thread when a filter lets one post of it through', () => {
    const out = completeSelfThreads([b], all, ME);
    expect(out.map((i) => i.atUri)).toEqual([uri('c'), uri('b'), uri('a')]);
  });

  it('returns the subset itself when no thread needs completing', () => {
    const subset = [x, y];
    expect(completeSelfThreads(subset, all, ME)).toBe(subset);
    const whole = all.slice(0, 4);
    expect(completeSelfThreads(whole, all, ME)).toBe(whole);
    expect(completeSelfThreads([], all, ME)).toEqual([]);
  });
});

describe('missingSelfParents', () => {
  it('names the posts of mine that loaded self-replies answer but nothing holds', () => {
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
    const d = post('d', '2020-01-01T00:04:00Z', { parent: uri('z') });
    const toOther = post('e', '2020-01-01T00:05:00Z', { parent: uri('o'), parentDid: OTHER });
    // B's parent A is missing; C's parent B is loaded; D's parent Z is known
    // to the wider feed; a reply to someone else is never ours to fetch.
    expect(missingSelfParents([c, b, d, toOther], [post('z', 'x')], ME)).toEqual([uri('a')]);
    expect(missingSelfParents([c, b], [], null)).toEqual([]);
  });
});

describe('threadEngagement', () => {
  it('adds up the posts and drops the replies the thread makes to itself', () => {
    const counts = (likeCount, replyCount, repostCount, quoteCount = 0) => ({
      payload: { likeCount, replyCount, repostCount, quoteCount },
    });
    // The 404 thread: 3 + 1 + 1 replies, two of them its own continuations.
    expect(threadEngagement([counts(28, 3, 2, 1), counts(11, 1, 2), counts(14, 1, 3)])).toEqual({
      likeCount: 53,
      replyCount: 3,
      repostCount: 7,
      quoteCount: 1,
    });
    // Counts that haven't caught up with the continuations never go negative.
    expect(threadEngagement([counts(1, 0, 0), counts(0, 0, 0)]).replyCount).toBe(0);
  });
});

describe('threadAwareDateKey', () => {
  it('prefers the thread anchor, then createdAt, then null', () => {
    expect(
      threadAwareDateKey({ createdAt: 'x', _thread: { anchorAt: 'anchor' } }),
    ).toBe('anchor');
    expect(threadAwareDateKey({ createdAt: 'x' })).toBe('x');
    expect(threadAwareDateKey({})).toBeNull();
    expect(threadAwareDateKey(null)).toBeNull();
  });
});

describe('selfThreadMembers', () => {
  it('collects every atUri in a genuine self-reply thread of 2+', () => {
    const a = post('a', '2020-01-01T00:01:00Z');
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
    const members = selfThreadMembers([c, b, a], ME);
    expect(members).toEqual(new Set([uri('a'), uri('b'), uri('c')]));
  });

  it('excludes a thread whose root is itself a reply to someone else (tainted)', () => {
    // A replies to another user; B and C then self-reply down the chain. The
    // whole conversation is a reply-to-other context, so none are kept.
    const a = post('a', '2020-01-01T00:01:00Z', { parent: uri('z'), parentDid: OTHER });
    const b = post('b', '2020-01-01T00:02:00Z', { parent: uri('a') });
    const c = post('c', '2020-01-01T00:03:00Z', { parent: uri('b') });
    expect(selfThreadMembers([c, b, a], ME).size).toBe(0);
  });

  it('returns an empty set when nothing can form a 2+ thread', () => {
    const orphan = post('r', '2020-01-01T00:02:00Z', { parent: uri('missing') });
    const other = post('s', '2020-01-01T00:05:00Z');
    expect(selfThreadMembers([other, orphan], ME).size).toBe(0);
    expect(selfThreadMembers([post('a', 'x')], ME).size).toBe(0);
    expect(selfThreadMembers([other, orphan], null).size).toBe(0);
  });
});

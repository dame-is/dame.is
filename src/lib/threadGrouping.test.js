import { describe, it, expect } from 'vitest';
import {
  groupSelfReplyThreads,
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

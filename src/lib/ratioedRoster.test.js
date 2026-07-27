import { describe, it, expect } from 'vitest';
import { rosterFromEvents, mergeRoster } from './ratioedRoster.js';

const ev = (k, did, h, pre = 1, extra = {}) => ({ k, did, h, pre, off: 1, ...extra });

const piece = (take, events, breaker = { handle: 'someone.test', likeSurvives: true }) => ({
  take,
  rkey: `r${take}`,
  breaker,
  events,
});

describe('rosterFromEvents', () => {
  it('counts each person by DID across the pieces they touched', () => {
    const people = rosterFromEvents([
      piece(12, [ev('reply', 'did:plc:a', 'a.test'), ev('repost', 'did:plc:b', 'b.test')]),
      piece(13, [ev('reply', 'did:plc:a', 'a.test', 0)]),
    ]);
    const a = people.find((p) => p.did === 'did:plc:a');
    expect(a).toMatchObject({ h: 'a.test', ev: 2, pre: [12], post: [13] });
    expect(a.kinds).toEqual({ reply: 2 });
  });

  it("skips the artist's own records, as every other count does", () => {
    // Nobody is left: the only event is dame's, and a breaker whose like
    // survives is already in the log rather than invented from the breaker
    // field, so an empty log means an empty roster.
    const people = rosterFromEvents([
      piece(12, [ev('reply', 'did:plc:me', 'dame.is', 1, { self: 1 })]),
    ]);
    expect(people).toEqual([]);
  });

  it('tags the breaker on the piece they broke', () => {
    const people = rosterFromEvents([
      piece(12, [ev('like', 'did:plc:a', 'a.test')], { handle: 'a.test', likeSurvives: true }),
    ]);
    expect(people.find((p) => p.did === 'did:plc:a').broke).toBe(12);
  });

  it('lists a breaker whose like was deleted, who has no events at all', () => {
    // Their like is gone from every index. Without this they'd vanish from a
    // roster of the people who were there.
    const people = rosterFromEvents([
      piece(12, [ev('reply', 'did:plc:a', 'a.test')], {
        handle: 'gone.test',
        did: 'did:plc:gone',
        likeSurvives: false,
      }),
    ]);
    const gone = people.find((p) => p.did === 'did:plc:gone');
    expect(gone).toMatchObject({ h: 'gone.test', ev: 0, pre: [12], broke: 12 });
  });

  it('marks an entry the log could only key by handle', () => {
    // Logs recorded before DIDs were captured. Listable, but not safe to merge
    // against a DID-keyed roster.
    const people = rosterFromEvents([piece(12, [{ k: 'reply', h: 'a.test', pre: 1, off: 1 }])]);
    expect(people.find((p) => p.h === 'a.test').weakKey).toBe(true);
  });

  it('returns nothing for pieces that carry no log', () => {
    expect(rosterFromEvents([{ take: 12, breaker: { handle: 'unknown' } }])).toEqual([]);
    expect(rosterFromEvents(null)).toEqual([]);
  });
});

describe('mergeRoster', () => {
  const base = [
    { did: 'did:plc:a', h: 'a.test', dn: 'Ada', ev: 3, pre: [4], post: [], kinds: { reply: 3 } },
    { did: 'did:plc:x', h: '(unresolvable)', dn: '', ev: 1, pre: [4], post: [], kinds: { repost: 1 } },
    { did: 'did:plc:y', h: '(unresolvable)', dn: '', ev: 1, pre: [5], post: [], kinds: { reply: 1 } },
  ];

  it('adds up the counts for someone in both', () => {
    const out = mergeRoster(base, [
      { did: 'did:plc:a', h: 'a.test', ev: 2, pre: [12], post: [13], kinds: { reply: 1, quote: 1 } },
    ]);
    const a = out.find((p) => p.did === 'did:plc:a');
    expect(a).toMatchObject({ ev: 5, dn: 'Ada', pre: [4, 12], post: [13] });
    expect(a.kinds).toEqual({ reply: 4, quote: 1 });
  });

  it('keeps the bundled display name rather than the blank derived one', () => {
    const out = mergeRoster(base, [{ did: 'did:plc:a', h: 'a.test', dn: '', ev: 1, pre: [12], post: [], kinds: {} }]);
    expect(out.find((p) => p.did === 'did:plc:a').dn).toBe('Ada');
  });

  it('adds someone the bundle has never seen', () => {
    const out = mergeRoster(base, [
      { did: 'did:plc:new', h: 'new.test', ev: 1, pre: [12], post: [], kinds: { reply: 1 }, broke: 12 },
    ]);
    expect(out).toHaveLength(4);
    expect(out.find((p) => p.did === 'did:plc:new').broke).toBe(12);
  });

  it('refuses to merge a handle-keyed entry onto a shared placeholder', () => {
    // Two deactivated accounts answer to "(unresolvable)". Folding counts into
    // either one would invent participation for a person.
    const out = mergeRoster(base, [
      { did: 'handle:(unresolvable)', h: '(unresolvable)', weakKey: true, ev: 5, pre: [12], post: [], kinds: { reply: 5 } },
    ]);
    expect(out).toHaveLength(3);
    for (const p of out.filter((x) => x.h === '(unresolvable)')) expect(p.ev).toBe(1);
  });

  it('matches a handle-keyed entry when the handle is unambiguous', () => {
    const out = mergeRoster(base, [
      { did: 'handle:a.test', h: 'a.test', weakKey: true, ev: 1, pre: [12], post: [], kinds: { reply: 1 } },
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((p) => p.did === 'did:plc:a').ev).toBe(4);
  });

  it('never leaves the internal weakKey marker on a roster entry', () => {
    const out = mergeRoster([], [
      { did: 'handle:n.test', h: 'n.test', weakKey: true, ev: 1, pre: [12], post: [], kinds: {} },
    ]);
    expect(out[0].weakKey).toBeUndefined();
  });

  it('leaves the bundle alone when there is nothing to merge', () => {
    expect(mergeRoster(base, [])).toHaveLength(3);
    expect(base[0].pre).toEqual([4]); // and doesn't mutate it
  });
});

import { describe, it, expect } from 'vitest';
import { countOf, countsSentence, listJoin, recordSentence, rowVerb } from './ratioedLedger.js';

const ME = 'did:plc:artist';
const row = (k, did, extra = {}) => ({ k, did, rkey: `${k}-${did}-${extra.n || 0}`, offMs: 1000, ...extra });
const said = (segments) => segments.map((s) => s.text).join(' · ');

describe('listJoin and countOf', () => {
  it('joins the way a sentence does', () => {
    expect(listJoin([])).toBe('');
    expect(listJoin(['a'])).toBe('a');
    expect(listJoin(['a', 'b'])).toBe('a and b');
    expect(listJoin(['a', 0, 'b', '', 'c'])).toBe('a, b and c');
  });

  it('counts in the singular and the plural', () => {
    expect(countOf(1, 'reply')).toBe('1 reply');
    expect(countOf(21, 'reply')).toBe('21 replies');
    expect(countOf(1, 'person')).toBe('1 person');
    expect(countOf(25, 'person')).toBe('25 people');
  });
});

describe('rowVerb', () => {
  it('names what the record did, and the artist as the artist', () => {
    expect(rowVerb({ k: 'reply', did: 'did:plc:x' }, { selfDid: ME })).toBe('replied');
    expect(rowVerb({ k: 'repost' })).toBe('reposted');
    expect(rowVerb({ k: 'quote' })).toBe('quoted');
    expect(rowVerb({ k: 'like' })).toBe('liked');
    expect(rowVerb({ k: 'reply', did: ME }, { selfDid: ME })).toBe('the artist');
  });
});

describe('countsSentence', () => {
  it('says nothing has happened when nothing has', () => {
    expect(said(countsSentence([], { selfDid: ME }))).toBe('Nothing has touched it yet');
    // The artist's own reply is not the piece drawing anybody.
    expect(said(countsSentence([row('reply', ME)], { selfDid: ME }))).toBe('Nothing has touched it yet');
  });

  it('reads the ordinary state as one line of counts', () => {
    const rows = [
      row('reply', 'did:plc:a'),
      row('reply', 'did:plc:b'),
      row('repost', 'did:plc:a'),
      row('quote', 'did:plc:c'),
      row('reply', ME),
    ];
    expect(said(countsSentence(rows, { selfDid: ME }))).toBe('2 replies · 1 repost · 1 quote · 3 people');
  });

  it('leaves out the kinds nobody has done', () => {
    expect(said(countsSentence([row('reply', 'did:plc:a')]))).toBe('1 reply · 1 person');
  });

  it('never counts the likes: a like is what ends the piece, and is said elsewhere', () => {
    const out = countsSentence([row('reply', 'did:plc:a'), row('like', 'did:plc:b')]);
    expect(said(out)).toBe('1 reply · 2 people');
    expect(out.some((s) => /like/.test(s.text))).toBe(false);
    // A like alone, or one taken back, is not "nothing": the statement says it.
    expect(countsSentence([row('like', 'did:plc:b')])).toEqual([]);
    expect(countsSentence([row('like', 'did:plc:b', { goneMs: 5000 })])).toEqual([]);
  });

  it('counts deletions after what is standing', () => {
    const out = countsSentence([
      row('reply', 'did:plc:a'),
      row('reply', 'did:plc:b', { goneMs: 9000 }),
      row('repost', 'did:plc:c', { goneMs: 9000 }),
    ]);
    expect(said(out)).toBe('1 reply · 1 person · 2 deleted');
  });
});

describe('recordSentence', () => {
  const record = { take: 27, lifespanMs: 54 * 60_000 + 1000 };

  it('says how far short of the record, and how many it has outlived', () => {
    expect(
      recordSentence({ elapsedMs: 33 * 60_000 + 30_000, record, passed: 38, total: 41 }),
    ).toBe('20m31s short of take 27’s record · longer than 38 of 41');
  });

  it('leaves the comparison out until it has outlived one', () => {
    expect(recordSentence({ elapsedMs: 5000, record, passed: 0, total: 41 })).toBe(
      '53m56s short of take 27’s record',
    );
  });

  it('says so once the record falls', () => {
    expect(recordSentence({ elapsedMs: 58 * 60_000 + 11_000, record, passed: 40, total: 41 })).toBe(
      '4m10s past take 27’s record · the longest yet',
    );
  });

  it('pads an early take and has nothing to say without a record', () => {
    expect(recordSentence({ elapsedMs: 0, record: { take: 3, lifespanMs: 16_000 } })).toBe(
      '16s short of take 03’s record',
    );
    expect(recordSentence({ elapsedMs: 1000, record: null })).toBeNull();
  });
});

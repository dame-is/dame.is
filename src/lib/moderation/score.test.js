import { describe, it, expect } from 'vitest';
import {
  trustScore,
  assignBand,
  distanceFrom,
  summarise,
  DEFAULT_THRESHOLDS,
} from './score.js';
import { referenceFrom } from './precompute.js';

describe('assignBand', () => {
  it('lets a protected reason beat every other signal', () => {
    const band = assignBand({
      protectedReason: 'you follow them',
      vouches: 0,
      followers: 0,
    });
    expect(band).toBe('PROTECTED');
  });

  it('puts the katie case in CONNECTED', () => {
    // 24 vouches, 57,916 followers — swept into a bulk block by the old tool.
    // This is the specific failure the gate exists to stop, so it gets a test.
    expect(assignBand({ vouches: 24, followers: 57916 })).toBe('CONNECTED');
  });

  it('promotes a single vouch to CONNECTED only when reach is real', () => {
    expect(assignBand({ vouches: 1, followers: 6000 })).toBe('CONNECTED');
    expect(assignBand({ vouches: 1, followers: 400 })).toBe('PERIPHERAL');
  });

  it('catches an unvouched account with a large audience as NOTABLE', () => {
    expect(assignBand({ vouches: 0, followers: 40000 })).toBe('NOTABLE');
  });

  it('catches a loud unvouched account below the reach bar', () => {
    expect(assignBand({ vouches: 0, followers: 3000, postsPerDay: 45 })).toBe(
      'NOTABLE',
    );
  });

  it('leaves an ordinary stranger in UNKNOWN', () => {
    // The median sweep member: ~3yr old, 372 followers, 1 post/day, no vouches.
    expect(
      assignBand({ vouches: 0, followers: 372, postsPerDay: 1, ageDays: 1017 }),
    ).toBe('UNKNOWN');
  });

  it('honours overridden thresholds from the portal', () => {
    const strict = { ...DEFAULT_THRESHOLDS, notableReach: 500 };
    expect(assignBand({ vouches: 0, followers: 900 }, strict)).toBe('NOTABLE');
    expect(assignBand({ vouches: 0, followers: 900 })).toBe('UNKNOWN');
  });
});

describe('trustScore', () => {
  it('ranks by vouches ahead of raw reach', () => {
    const vouched = trustScore({ vouches: 10, followers: 800 });
    const popular = trustScore({ vouches: 0, followers: 200000 });
    expect(vouched).toBeGreaterThan(popular);
  });

  it('stays inside 0..99 so PROTECTED at 100 always sorts first', () => {
    const max = trustScore({
      vouches: 999,
      followers: 10_000_000,
      ageDays: 5000,
      mutual: true,
    });
    expect(max).toBeLessThanOrEqual(99);
    expect(trustScore({})).toBeGreaterThanOrEqual(0);
  });

  it('gives a mutual more weight than a one-way follower', () => {
    const base = { vouches: 2, followers: 1000, ageDays: 900 };
    expect(trustScore({ ...base, mutual: true })).toBeGreaterThan(
      trustScore({ ...base, followsYou: true }),
    );
  });
});

describe('distanceFrom', () => {
  it('reports 0..3, where 3 means "not found" rather than three hops', () => {
    expect(distanceFrom({ inCircle: true, vouches: 0 })).toBe(0);
    expect(distanceFrom({ inCircle: false, vouches: 2 })).toBe(1);
    expect(
      distanceFrom({ inCircle: false, vouches: 0, inNeighbourhood: true }),
    ).toBe(2);
    expect(distanceFrom({ inCircle: false, vouches: 0 })).toBe(3);
  });
});

describe('referenceFrom', () => {
  it('derives the neighbourhood from the vouch table rather than crawling', () => {
    const ref = referenceFrom({
      vouchRows: [
        { did: 'did:plc:a', vouches: 3 },
        { did: 'did:plc:b', vouches: 1 },
      ],
      circleDids: ['did:plc:c'],
      protectedRows: [{ did: 'did:plc:c', reason: 'you follow them' }],
    });
    expect(ref.vouches.get('did:plc:a')).toBe(3);
    expect(ref.neighbourhood.has('did:plc:b')).toBe(true);
    expect(ref.protectedSet.get('did:plc:c')).toBe('you follow them');
  });
});

describe('summarise', () => {
  const harvest = {
    uri: 'at://did:plc:me/app.bsky.feed.post/x',
    harvestedAt: '2026-09-16T00:00:00.000Z',
    truncated: false,
    totals: { participants: 4, engagements: { like: 3, reply: 1 }, records: 4 },
    participants: [
      {
        did: 'did:plc:me',
        engagements: { reply: 1 },
        primary: 'reply',
        total: 1,
      },
      { did: 'did:plc:a', engagements: { like: 1 }, primary: 'like', total: 1 },
      { did: 'did:plc:b', engagements: { like: 1 }, primary: 'like', total: 1 },
      { did: 'did:plc:c', engagements: { like: 1 }, primary: 'like', total: 1 },
    ],
  };
  const scores = new Map([
    ['did:plc:a', { band: 'CONNECTED', trust: 90, followers: 5000 }],
    ['did:plc:b', { band: 'UNKNOWN', trust: 12, followers: 100 }],
    ['did:plc:c', { band: 'PROTECTED', trust: 100, followers: 9000 }],
  ]);

  it('drops the post author so a thread is not a roster of yourself', () => {
    const s = summarise(harvest, scores, { excludeSelf: 'did:plc:me' });
    expect(s.rows).toHaveLength(3);
    expect(s.rows.some((r) => r.did === 'did:plc:me')).toBe(false);
  });

  it('separates the named review set from the auto-eligible count', () => {
    const s = summarise(harvest, scores, { excludeSelf: 'did:plc:me' });
    expect(s.requiresReview.map((r) => r.did)).toEqual([
      'did:plc:c',
      'did:plc:a',
    ]);
    expect(s.autoEligible.map((r) => r.did)).toEqual(['did:plc:b']);
  });

  it('totals the reach of the review set, which is who would notice', () => {
    const s = summarise(harvest, scores, { excludeSelf: 'did:plc:me' });
    expect(s.totals.reviewReach).toBe(14000);
    expect(s.totals.byBand.CONNECTED).toBe(1);
  });

  it('treats an unscored participant as UNKNOWN rather than dropping them', () => {
    const s = summarise(harvest, new Map(), { excludeSelf: 'did:plc:me' });
    expect(s.rows).toHaveLength(3);
    expect(s.totals.byBand.UNKNOWN).toBe(3);
  });
});

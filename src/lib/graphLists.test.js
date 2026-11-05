// The managed lists rewrite real Bluesky lists on a timer, so the parts that
// decide WHO goes on them are pinned here: the window, the floors, the
// not-following filter, the moderation-list exclusion, the stickiness that
// stops a capped list churning, and a diff that never overshoots a cap.

import { describe, it, expect } from 'vitest';
import {
  MAX_LIST_SIZE,
  degreeBreakdown,
  describeRule,
  normalizeDefinition,
  orbitRadius,
  placeOf,
  planSync,
  rankEngagement,
  rankProximity,
  selectMembers,
  slugKey,
  stickyTop,
} from './graphLists.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12);
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const ev = (did, kind, days) => ({ did, kind, at: ago(days) });

describe('normalizeDefinition', () => {
  it('rejects unknown kinds rather than guessing', () => {
    expect(normalizeDefinition({ kind: 'nope' })).toBeNull();
  });

  it('clamps size and keeps the window at 30 days by default', () => {
    const d = normalizeDefinition({ kind: 'engaged-in', size: 50_000 });
    expect(d.size).toBe(MAX_LIST_SIZE);
    expect(d.windowDays).toBe(30);
    expect(d.protects).toBe(false);
  });

  it('drops mentions from outbound lists, where none are recorded', () => {
    const d = normalizeDefinition({ kind: 'engaged-out' });
    expect(d.kinds).not.toContain('mention');
    expect(normalizeDefinition({ kind: 'engaged-in' }).kinds).toContain(
      'mention',
    );
  });

  it('reads "1st degree, not followed" as 2nd degree, not as an empty list', () => {
    const d = normalizeDefinition({
      kind: 'proximity',
      maxDegree: 1,
      notFollowing: true,
    });
    expect(d.maxDegree).toBe(2);
  });

  it('describes a rule in one sentence', () => {
    expect(
      describeRule({
        kind: 'engaged-in',
        size: 25,
        minInteractions: 3,
        notFollowing: true,
      }),
    ).toBe(
      'Up to 25 people who engaged with you you don’t follow yet, at least 3 interactions in the last 30 days.',
    );
    expect(
      describeRule({
        kind: 'proximity',
        notFollowing: true,
        minVouches: 20,
        size: 150,
      }),
    ).toMatch(/at least 20 of your follows follow/);
  });
});

describe('slugKey', () => {
  it('makes a record key', () => {
    expect(slugKey('Who I engage with (not followed)')).toBe(
      'who-i-engage-with-not-followed',
    );
    expect(slugKey('')).toBe('list');
  });
});

describe('rankEngagement', () => {
  const events = [
    ev('a', 'like', 1),
    ev('a', 'like', 2),
    ev('a', 'reply', 3),
    ev('b', 'like', 1),
    ev('b', 'like', 40), // outside the window
    ev('c', 'mention', 1),
    ev('me', 'reply', 1),
  ];

  it('counts inside the window, applies the floor, drops the owner', () => {
    const rows = rankEngagement(events, {
      t0: NOW - 30 * DAY,
      t1: NOW,
      minInteractions: 1,
      excludeDid: 'me',
    });
    expect(rows.map((r) => [r.did, r.total])).toEqual([
      ['a', 3],
      ['b', 1],
      ['c', 1],
    ]);
    expect(rows[0].byKind).toEqual({ like: 2, reply: 1 });
  });

  it('filters by kind before the floor', () => {
    const rows = rankEngagement(events, {
      t0: NOW - 30 * DAY,
      t1: NOW,
      kinds: ['reply'],
      minInteractions: 1,
    });
    expect(rows.map((r) => r.did)).toEqual(['a', 'me']);
  });
});

describe('placeOf and degreeBreakdown', () => {
  const ctx = {
    following: new Set(['m', 'f']),
    followers: new Set(['m', 'x']),
    vouches: new Map([
      ['s', 5],
      ['w', 1],
      ['f', 9],
    ]),
  };

  it('uses the moderation gate’s distances', () => {
    expect(placeOf('m', ctx)).toMatchObject({
      mutual: true,
      distance: 0,
      degree: 1,
    });
    expect(placeOf('s', ctx)).toMatchObject({
      youFollow: false,
      distance: 1,
      degree: 2,
      vouches: 5,
    });
    expect(placeOf('x', ctx)).toMatchObject({
      followsYou: true,
      distance: 3,
      degree: null,
    });
  });

  it('buckets on the CONNECTED line', () => {
    expect(degreeBreakdown(['m', 'f', 's', 'w', 'x', 'z'], ctx)).toEqual({
      mutual: 1,
      following: 1,
      strong: 1,
      weak: 1,
      beyond: 2,
      total: 6,
    });
  });

  it('places closer accounts nearer the centre', () => {
    const r = (did) => orbitRadius(placeOf(did, ctx), { maxVouches: 9 });
    expect(r('m')).toBeLessThan(r('f'));
    expect(r('f')).toBeLessThan(r('s'));
    expect(r('s')).toBeLessThan(r('w'));
    expect(r('w')).toBeLessThan(r('x'));
  });
});

describe('rankProximity', () => {
  const vouches = new Map([
    ['a', 30],
    ['b', 30],
    ['c', 2],
    ['f', 50],
  ]);
  const following = new Set(['f']);

  it('puts 1st degree first, then vouches, then engagement as a tie-break', () => {
    const rows = rankProximity({
      vouches,
      following,
      minVouches: 1,
      boost: new Map([['b', 4]]),
    });
    expect(rows.map((r) => r.did)).toEqual(['f', 'b', 'a', 'c']);
  });

  it('honours notFollowing and the vouch floor', () => {
    const rows = rankProximity({
      vouches,
      following,
      minVouches: 10,
      notFollowing: true,
    });
    expect(rows.map((r) => r.did)).toEqual(['a', 'b']);
  });
});

describe('stickyTop', () => {
  const ranked = ['a', 'b', 'c', 'd', 'e', 'f'].map((did) => ({ did }));

  it('is a plain top-n with no incumbents', () => {
    expect(stickyTop(ranked, new Set(), 3, 1).map((r) => r.did)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps an incumbent that slipped just past the cut', () => {
    expect(stickyTop(ranked, new Set(['d']), 3, 1).map((r) => r.did)).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('lets one that drifted far go', () => {
    expect(stickyTop(ranked, new Set(['f']), 3, 1).map((r) => r.did)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('selectMembers', () => {
  const signals = {
    inbound: [
      ev('a', 'like', 1),
      ev('a', 'like', 2),
      ev('b', 'like', 1),
      ev('b', 'like', 3),
      ev('mod', 'reply', 1),
      ev('mod', 'reply', 2),
    ],
    outbound: [ev('c', 'like', 1)],
    following: new Set(['a']),
    vouches: new Map([['z', 40]]),
    excluded: new Set(['mod']),
  };

  it('builds an inbound list, skipping the moderation list and people you follow', () => {
    const { rows, eligible } = selectMembers(
      { kind: 'engaged-in', minInteractions: 2, notFollowing: true, size: 10 },
      signals,
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.did)).toEqual(['b']);
    expect(eligible).toBe(1);
  });

  it('builds a proximity list from the vouch table', () => {
    const { rows } = selectMembers(
      { kind: 'proximity', notFollowing: true, minVouches: 10, size: 10 },
      signals,
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.did)).toEqual(['z']);
  });
});

describe('planSync', () => {
  const current = [
    { did: 'a', uri: 'at://me/l/1' },
    { did: 'b', uri: 'at://me/l/2' },
    { did: 'a', uri: 'at://me/l/3' },
  ];

  it('adds, removes and de-duplicates', () => {
    const plan = planSync(current, ['a', 'c']);
    expect(plan.add).toEqual(['c']);
    expect(plan.remove.map((r) => r.uri)).toEqual([
      'at://me/l/2',
      'at://me/l/3',
    ]);
    expect(plan.kept).toBe(1);
    expect(plan.pending).toBe(0);
  });

  it('removes before it adds when capped, and says what is left', () => {
    const plan = planSync(current, ['a', 'c', 'd'], { maxWrites: 2 });
    expect(plan.remove).toHaveLength(2);
    expect(plan.add).toEqual([]);
    expect(plan.pending).toBe(2);
  });
});

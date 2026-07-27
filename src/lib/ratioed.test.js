import { describe, it, expect } from 'vitest';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  splitParticipants,
  livingRoster,
  roleOf,
  hiddenReplies,
  WEEKDAYS,
  normalizePiece,
  localSlot,
  whenMarks,
  areaRadius,
  aggregate,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from './ratioed.js';

describe('SEED_PIECES', () => {
  it('carries all eleven pieces in take order', () => {
    expect(SEED_PIECES).toHaveLength(11);
    expect(SEED_PIECES.map((p) => p.take)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keys each record by its subject post rkey', () => {
    for (const p of SEED_PIECES) {
      expect(p.subject.endsWith(`/${p.rkey}`)).toBe(true);
    }
  });

  it('seals every piece after it was posted', () => {
    for (const p of SEED_PIECES) {
      const span = Date.parse(p.sealedAt) - Date.parse(p.postedAt);
      expect(span).toBeGreaterThan(0);
      // lifespanMs is derived from those two timestamps, so it must agree with
      // them to the millisecond.
      expect(Math.abs(span - p.lifespanMs)).toBeLessThanOrEqual(1);
    }
  });

  it('records a reaction time exactly when the breaking like survives', () => {
    for (const p of SEED_PIECES) {
      const hasReaction = typeof p.breaker.reactionMs === 'number';
      expect(hasReaction).toBe(p.breaker.likeSurvives);
    }
  });

  it('keeps every measured reaction inside the window the ghost markers draw', () => {
    const measured = SEED_PIECES.map((p) => p.breaker.reactionMs).filter(
      (ms) => typeof ms === 'number',
    );
    expect(measured).toHaveLength(5);
    for (const ms of measured) {
      expect(ms).toBeGreaterThan(9_000);
      expect(ms).toBeLessThan(18_000);
    }
  });

  it('leaves the six deleted likes unmeasurable', () => {
    const deleted = SEED_PIECES.filter((p) => !p.breaker.likeSurvives);
    expect(deleted).toHaveLength(6);
    for (const p of deleted) {
      expect(p.breaker.reactionMs).toBeUndefined();
    }
  });

  it('never claims a like arrived while a piece was alive except from its breaker', () => {
    // Any surviving pre-seal like IS the breaking like, so a piece with a
    // pre-seal like must be one whose breaker's like survived.
    for (const p of SEED_PIECES) {
      if (p.preSeal.likes > 0) expect(p.breaker.likeSurvives).toBe(true);
    }
  });
});

describe('normalizePiece', () => {
  it('fills in missing engagement blocks rather than throwing', () => {
    const p = normalizePiece('abc', { take: 3, subject: 'at://x', lifespanMs: 100 });
    expect(p.preSeal).toEqual({
      likes: 0,
      reposts: 0,
      quotes: 0,
      threadPosts: 0,
      participants: 0,
    });
    expect(p.postSeal.likes).toBe(0);
    expect(p.breaker.handle).toBe('unknown');
  });

  it('returns null for an absent value', () => {
    expect(normalizePiece('abc', null)).toBeNull();
  });

  it('decodes a recorded event log into the seconds the charts plot', () => {
    // Records carry milliseconds — lexicon v1 has no float type — while the
    // harvested log and every chart work in seconds.
    const p = normalizePiece('abc', {
      take: 12,
      events: [
        { k: 'reply', h: 'b.test', offMs: 22723, pre: 1, self: 1 },
        { k: 'like', h: 'a.test', offMs: 892035, pre: 1 },
        { k: 'reply', offMs: 970169, pre: 0, t: 'after the seal' },
      ],
    });
    expect(p.events.map((e) => e.off)).toEqual([22.723, 892.035, 970.169]);
    expect(p.events[0].self).toBe(1);
    expect(p.events[1].self).toBeUndefined();
    expect(p.events[2].h).toBe('(unresolvable)');
    expect(p.events[2].t).toBe('after the seal');
  });

  it('reports no log at all rather than an empty one', () => {
    // The charts fall back to the bundled log on null; an empty array would
    // read as "measured, and nothing happened".
    expect(normalizePiece('abc', { take: 1 }).events).toBeNull();
    expect(normalizePiece('abc', { take: 1, events: [] }).events).toBeNull();
  });

  it('preserves a full record', () => {
    const src = SEED_PIECES[3];
    const p = normalizePiece(src.rkey, src);
    expect(p.take).toBe(4);
    expect(p.preSeal.threadPosts).toBe(src.preSeal.threadPosts);
    expect(p.breaker.likeSurvives).toBe(false);
  });
});

describe('aggregate', () => {
  const stats = aggregate(SEED_PIECES);

  it('measures five reaction times and misses six', () => {
    expect(stats.measured).toBe(5);
    expect(stats.deleted).toBe(6);
  });

  it('puts the mean reaction in the 13-second band', () => {
    expect(stats.meanReactionMs / 1000).toBeCloseTo(13.0, 1);
    expect(stats.minReactionMs / 1000).toBeCloseTo(10.0, 1);
    expect(stats.maxReactionMs / 1000).toBeCloseTo(17.0, 1);
  });

  it('finds take 4 as the longest-lived piece', () => {
    const longest = SEED_PIECES.find((p) => p.lifespanMs === stats.maxLifespanMs);
    expect(longest.take).toBe(4);
    expect(Math.round(stats.maxLifespanMs / 1000)).toBe(1764);
  });

  it('totals about 74 minutes of life across the whole project', () => {
    expect(Math.round(stats.aliveMs / 60000)).toBe(74);
  });

  it('counts far more non-like engagement than likes while alive', () => {
    // The name of the project, as a number: pieces are ratioed by design.
    expect(stats.likes).toBe(5);
    expect(stats.nonLike).toBe(123);
  });

  it('handles an empty list without dividing by zero', () => {
    const empty = aggregate([]);
    expect(empty.count).toBe(0);
    expect(empty.meanReactionMs).toBeNull();
    expect(empty.maxLifespanMs).toBe(0);
  });
});

describe('SEED_PEOPLE', () => {
  it('counts everyone by DID, not by handle', () => {
    expect(SEED_PEOPLE).toHaveLength(135);
    expect(new Set(SEED_PEOPLE.map((p) => p.did)).size).toBe(135);
    // Two deactivated accounts share one placeholder handle; counting by
    // handle would silently lose one of them.
    expect(new Set(SEED_PEOPLE.map((p) => p.h)).size).toBe(134);
  });

  it('splits into living and after-the-fact participation', () => {
    const { total, living, afterOnly, breakersListed } = splitParticipants();
    expect(total).toBe(135);
    expect(living).toBe(77);
    expect(living + afterOnly).toBe(total);
    // Seven breakers left any record at all, but one of them — restedwicked,
    // who broke #04 — only shows up after the seal, their like having been
    // deleted. The participants table lists living participation, so it counts
    // six.
    expect(breakersListed).toBe(6);
  });

  it('gives everyone at least one event and one piece', () => {
    for (const p of SEED_PEOPLE) {
      expect(p.ev).toBeGreaterThan(0);
      expect(p.pre.length + p.post.length).toBeGreaterThan(0);
    }
  });

  it('tags only breakers who left a record behind', () => {
    const tagged = SEED_PEOPLE.filter((p) => p.broke);
    // Four of the eleven deleted their like and did nothing else, so they
    // never appear in a backlink index at all.
    expect(tagged).toHaveLength(7);
    for (const p of tagged) {
      expect(p.broke).toBeGreaterThanOrEqual(1);
      expect(p.broke).toBeLessThanOrEqual(11);
    }
  });
});

describe('livingRoster', () => {
  it('lists the measured living participants', () => {
    const { rows, measured } = livingRoster(SEED_PIECES);
    expect(measured).toBe(77);
    for (const p of rows.slice(0, measured)) expect(p.pre.length).toBeGreaterThan(0);
  });

  it('recovers the breakers whose like was deleted from the announcement', () => {
    // Their like is gone from every index; the reply concluding the piece is
    // the only record that they were ever there, and leaving them out would
    // drop the people the project is actually about.
    const { rows, named, deleted } = livingRoster(SEED_PIECES);
    expect(named).toBe(5);
    // Six pieces lost their breaking like. Five of those breakers left nothing
    // else and have to be named; the sixth, j4ck, replied to another piece
    // while it was alive, so they were already in the roster — their deleted
    // like is marked on the row they already had.
    expect(deleted).toBe(6);
    expect(rows.find((p) => p.h === 'j4ck.xyz')).toMatchObject({ broke: 7, likeGone: true });
    const recovered = rows.filter((p) => p.named);
    expect(recovered.map((p) => p.broke).sort((a, b) => a - b)).toEqual([2, 4, 5, 8, 10]);
    for (const p of recovered) {
      expect(p.ev).toBe(0);
      expect(p.live).toBe(0);
      expect(p.likeGone).toBe(true);
    }
  });

  it('credits a named breaker whose like is still standing', () => {
    // Piece 12 was measured after the roster was built, so its breaker is
    // missing from it — but their like is real and countable, and calling it
    // deleted would be a plain falsehood about a person.
    const pieces = [
      { take: 12, breaker: { handle: 'still.here', likeSurvives: true, reactionMs: 12659 } },
    ];
    const { rows, named, deleted } = livingRoster(pieces, []);
    expect(named).toBe(1);
    expect(deleted).toBe(0);
    expect(rows[0]).toMatchObject({ h: 'still.here', ev: 1, live: 1, likeGone: false });
    expect(rows[0].kinds).toEqual({ like: 1 });
  });

  it('marks a breaker whose like was deleted, wherever their row came from', () => {
    // The mark belongs to the piece, not to how the person got into the list.
    const pieces = [{ take: 1, breaker: { handle: 'a.test', likeSurvives: false } }];
    const people = [{ did: 'did:plc:a', h: 'a.test', ev: 1, pre: [2], post: [], kinds: { reply: 1 }, broke: 1 }];
    const { rows } = livingRoster(pieces, people);
    expect(rows[0]).toMatchObject({ likeGone: true, broke: 1 });
  });

  it('counts every breaker it lists', () => {
    const { rows, breakers } = livingRoster(SEED_PIECES);
    expect(breakers).toBe(rows.filter((p) => p.broke).length);
    expect(breakers).toBe(11); // one per piece in the seed
  });

  it('never lists a breaker twice', () => {
    const { rows } = livingRoster(SEED_PIECES);
    expect(new Set(rows.map((p) => p.did)).size).toBe(rows.length);
    // Every piece is accounted for by exactly one row.
    const broke = rows.filter((p) => p.broke).map((p) => p.broke);
    expect(new Set(broke).size).toBe(broke.length);
  });

  it('accounts for every piece that names a breaker', () => {
    const { rows } = livingRoster(SEED_PIECES);
    const named = new Set(rows.filter((p) => p.broke).map((p) => p.broke));
    for (const piece of SEED_PIECES) {
      if (piece.breaker.handle && piece.breaker.handle !== 'unknown') {
        expect(named.has(piece.take)).toBe(true);
      }
    }
  });

  it('matches a breaker to a measured row by handle, not just DID', () => {
    // The announcement records a handle; the roster is keyed by DID. Missing
    // the match would list the same person twice.
    const people = [
      { did: 'did:plc:a', h: 'breaker.test', ev: 2, pre: [1], post: [], kinds: { reply: 2 } },
    ];
    const pieces = [{ take: 1, breaker: { handle: 'breaker.test', likeSurvives: true } }];
    const { rows, named } = livingRoster(pieces, people);
    expect(named).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it('ignores a piece whose breaker was never identified', () => {
    const pieces = [{ take: 1, breaker: { handle: 'unknown' } }, { take: 2, breaker: {} }];
    expect(livingRoster(pieces, []).named).toBe(0);
  });

  it('handles no pieces at all', () => {
    expect(livingRoster(null, []).rows).toEqual([]);
  });
});

describe('roleOf', () => {
  const person = (kinds, extra = {}) => ({ kinds, ...extra });

  it('names the act that carried the piece furthest, not the commonest one', () => {
    // Nine replies and one repost reads as "reposted": the repost is what took
    // the piece off the thread. The Mix column still shows all ten.
    expect(roleOf(person({ reply: 9, repost: 1 })).label).toBe('reposted');
    expect(roleOf(person({ reply: 3, repost: 2, quote: 1 })).label).toBe('quoted');
    expect(roleOf(person({ reply: 4 })).label).toBe('replied');
  });

  it('lets breaking a piece outrank everything', () => {
    const r = roleOf(person({ reply: 2, quote: 1 }, { broke: 6 }));
    expect(r.label).toBe('broke #06');
    expect(r.key).toBe('broke');
  });

  it('prefers what someone did while the piece was alive', () => {
    // Replied to a living piece, quoted a finished one. Calling them a quoter
    // would credit them with spreading something already over.
    const p = person({ reply: 1, quote: 1 }, { liveKinds: { reply: 1 } });
    expect(roleOf(p).label).toBe('replied');
  });

  it('falls back to the all-window counts when the log says nothing', () => {
    expect(roleOf(person({ repost: 1 }, { liveKinds: null })).label).toBe('reposted');
  });

  it('still names someone whose acts do not fit any of the four', () => {
    expect(roleOf(person({})).label).toBe('was there');
  });

  it('carries a key the palette can colour by', () => {
    expect(roleOf(person({ quote: 1 })).key).toBe('quote');
    expect(roleOf(person({ repost: 1 })).key).toBe('repost');
    expect(roleOf(person({ reply: 1 })).key).toBe('reply');
  });
});

describe('livingRoster living kinds', () => {
  const people = [
    { did: 'did:plc:a', h: 'a.test', ev: 2, pre: [1], post: [2], kinds: { reply: 1, repost: 1 } },
    { did: 'did:plc:x', h: '(unresolvable)', ev: 1, pre: [1], post: [], kinds: { repost: 1 } },
    { did: 'did:plc:y', h: '(unresolvable)', ev: 1, pre: [1], post: [], kinds: { reply: 1 } },
  ];
  const events = {
    r1: [
      { k: 'reply', h: 'a.test', off: 5, pre: 1 },
      { k: 'repost', h: '(unresolvable)', off: 6, pre: 1 },
      { k: 'reply', h: 'dame.is', off: 7, pre: 1, self: 1 },
    ],
    r2: [{ k: 'repost', h: 'a.test', off: 200, pre: 0 }],
  };
  const pieces = [{ take: 1, rkey: 'r1', breaker: { handle: 'a.test' } }];

  it('counts only what landed while a piece was alive', () => {
    const { rows } = livingRoster(pieces, people, events);
    const a = rows.find((p) => p.h === 'a.test');
    // The repost was on a finished piece, so it isn't in the living count.
    expect(a.liveKinds).toEqual({ reply: 1 });
  });

  it('leaves the shared placeholder handle uncredited rather than guessing', () => {
    // Two deactivated accounts answer to one handle; an event naming it could
    // belong to either, and crediting both would invent an action.
    const { rows } = livingRoster(pieces, people, events);
    for (const p of rows.filter((r) => r.h === '(unresolvable)')) {
      expect(p.liveKinds).toBeNull();
    }
  });

  it('works with no event log at all', () => {
    const { rows } = livingRoster(pieces, people, null);
    for (const p of rows) expect(p.liveKinds).toBeNull();
  });
});

describe('hiddenReplies', () => {
  const events = {
    [SEED_PIECES[0].rkey]: [
      { k: 'reply', h: 'a.test', off: 10, pre: 1 },
      { k: 'reply', h: 'b.test', off: 80, pre: 0 },
      { k: 'like', h: 'c.test', off: 90, pre: 0 },
      { k: 'reply', h: 'dame.is', off: 70, pre: 0, self: 1 },
    ],
  };

  it('returns only non-self replies from after the seal', () => {
    const out = hiddenReplies(events, [SEED_PIECES[0]]);
    expect(out).toHaveLength(1);
    expect(out[0].h).toBe('b.test');
  });

  it('measures the offset from the seal, not from the post', () => {
    const [row] = hiddenReplies(events, [SEED_PIECES[0]]);
    // take #1 sealed at 48.832s; a reply at +80s landed ~31s after.
    expect(Math.round(row.afterSec)).toBe(31);
  });

  it('is empty until the event log has loaded', () => {
    expect(hiddenReplies(null, SEED_PIECES)).toEqual([]);
  });
});

describe('localSlot', () => {
  it('resolves into the artist’s zone, not UTC', () => {
    // 01:08 UTC on a Saturday is Friday evening in New York. Reading this in
    // UTC would put the piece on the wrong day AND the wrong half of the clock.
    const slot = localSlot('2026-02-21T01:08:01.648Z');
    expect(WEEKDAYS[slot.day]).toBe('Fri');
    expect(slot.hour).toBe(20);
    expect(slot.minute).toBe(8);
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // June is EDT (UTC-4); February is EST (UTC-5). Same UTC hour, different
    // local hour.
    expect(localSlot('2025-06-16T18:13:22.654Z').hour).toBe(14);
    expect(localSlot('2026-02-21T18:13:22.000Z').hour).toBe(13);
  });

  it('gives a fractional hour for positioning', () => {
    expect(localSlot('2025-06-16T14:23:12.764Z').atHour).toBeCloseTo(10 + 23 / 60, 5);
  });

  it('returns null for an unparseable timestamp', () => {
    expect(localSlot('not a date')).toBeNull();
    expect(localSlot('')).toBeNull();
  });
});

describe('whenMarks', () => {
  const marks = whenMarks(SEED_PIECES);

  it('places every piece', () => {
    expect(marks).toHaveLength(11);
    for (const m of marks) {
      expect(m.day).toBeGreaterThanOrEqual(0);
      expect(m.day).toBeLessThanOrEqual(6);
      expect(m.atHour).toBeGreaterThanOrEqual(0);
      expect(m.atHour).toBeLessThan(24);
    }
  });

  it('sums engagement across every kind that arrived while alive', () => {
    const four = marks.find((m) => m.take === 4);
    // 45 thread + 8 RT + 3 QT + 0 likes.
    expect(four.engagement).toBe(56);
    expect(four.participants).toBe(32);
  });

  it('lands the first three takes together on a Monday morning', () => {
    const early = marks.filter((m) => m.take <= 3);
    expect(early.every((m) => WEEKDAYS[m.day] === 'Mon')).toBe(true);
    expect(early.every((m) => m.hour === 10)).toBe(true);
  });

  it('drops a piece whose timestamp will not parse', () => {
    expect(whenMarks([{ ...SEED_PIECES[0], postedAt: 'nope' }])).toEqual([]);
  });
});

describe('areaRadius', () => {
  it('scales by area, so four times the value is twice the radius', () => {
    // Radius above the floor is what carries the value; check that span.
    const quarter = areaRadius(25, 100, 0, 10);
    const full = areaRadius(100, 100, 0, 10);
    expect(quarter).toBeCloseTo(5, 5);
    expect(full).toBeCloseTo(10, 5);
  });

  it('gives zero and empty maxima the floor rather than NaN', () => {
    expect(areaRadius(0, 100, 2, 10)).toBe(2);
    expect(areaRadius(5, 0, 2, 10)).toBe(2);
  });
});

describe('formatters', () => {
  it('formats durations under a minute as bare seconds', () => {
    expect(fmtDuration(48_832)).toBe('49s');
    expect(fmtDuration(0)).toBe('0s');
  });

  it('pads the seconds in minute-scale durations', () => {
    expect(fmtDuration(1_763_889)).toBe('29m24s');
    expect(fmtDuration(68_197)).toBe('1m08s');
  });

  it('keeps one decimal on reaction times and marks unknowns', () => {
    expect(fmtSeconds(11_304)).toBe('11.3s');
    expect(fmtSeconds(undefined)).toBe('—');
  });

  it('floats the unit across the afterlife range', () => {
    expect(fmtElapsed(31)).toBe('31s');
    expect(fmtElapsed(600)).toBe('10m');
    expect(fmtElapsed(7200)).toBe('2.0h');
    expect(fmtElapsed(86_400 * 405)).toBe('405d');
  });
});

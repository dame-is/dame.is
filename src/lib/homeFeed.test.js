import { describe, expect, it } from 'vitest';
import {
  assignRowKeys,
  carryOverFailedSources,
  classifyBuild,
  completeSince,
  insertHorizonMarkers,
  isHorizonMarker,
  rebuildVerbs,
  splitYearOnlyWorks,
  trimToHorizons,
} from './homeFeed.js';
import { collapseListens } from './listenSessions.js';
import { collapseObservations } from './observationBatches.js';

const ME = 'did:plc:test';
const uri = (nsid, rkey) => `at://${ME}/${nsid}/${rkey}`;
const item = (verb, nsid, rkey, createdAt, extra = {}) => ({
  verb,
  createdAt,
  atUri: uri(nsid, rkey),
  payload: {},
  ...extra,
});

describe('rebuildVerbs', () => {
  it('keeps the held defaults when the filter narrows', () => {
    expect(
      rebuildVerbs(
        ['posting', 'logging', 'listening'],
        new Set(['posting']),
      ).sort(),
    ).toEqual(['listening', 'logging', 'posting']);
  });

  it('lets go of an opt-in verb the filter no longer wants', () => {
    expect(rebuildVerbs(['posting', 'liking'], new Set(['posting']))).toEqual([
      'posting',
    ]);
    expect(
      rebuildVerbs(
        ['posting', 'liking'],
        new Set(['posting', 'liking']),
      ).sort(),
    ).toEqual(['liking', 'posting']);
  });

  it('fetches just what is wanted from a cold start', () => {
    expect(rebuildVerbs([], new Set(['logging']))).toEqual(['logging']);
    expect(rebuildVerbs(undefined, new Set())).toEqual([]);
  });
});

describe('classifyBuild', () => {
  it('tells a dead network from a partial outage from a good build', () => {
    expect(classifyBuild({ attempted: 5, failed: 5, labels: [] })).toBe(
      'failed',
    );
    expect(classifyBuild({ attempted: 5, failed: 2, labels: [] })).toBe(
      'partial',
    );
    expect(classifyBuild({ attempted: 5, failed: 0, labels: [] })).toBe('ok');
  });

  it('treats a build that attempted nothing as fine', () => {
    expect(classifyBuild({ attempted: 0, failed: 0, labels: [] })).toBe('ok');
    expect(classifyBuild(undefined)).toBe('ok');
  });
});

describe('carryOverFailedSources', () => {
  const current = [
    item('posting', 'app.bsky.feed.post', 'p2', '2026-10-27T10:00:00Z'),
    item('logging', 'is.dame.now', 's1', '2026-10-27T09:00:00Z'),
    item('posting', 'app.bsky.feed.post', 'p1', '2026-10-26T10:00:00Z'),
  ];

  it("keeps a failed source's rows from the feed on screen, in order", () => {
    const next = [
      item('logging', 'is.dame.now', 's2', '2026-10-27T11:00:00Z'),
      item('logging', 'is.dame.now', 's1', '2026-10-27T09:00:00Z'),
    ];
    const out = carryOverFailedSources(current, next, ['app.bsky.feed.post']);
    expect(out.map((i) => i.atUri.split('/').pop())).toEqual([
      's2',
      'p2',
      's1',
      'p1',
    ]);
  });

  it('never duplicates a row the new build already has', () => {
    const next = [
      item('posting', 'app.bsky.feed.post', 'p2', '2026-10-27T10:00:00Z'),
    ];
    const out = carryOverFailedSources(current, next, ['app.bsky.feed.post']);
    expect(out.map((i) => i.atUri.split('/').pop())).toEqual(['p2', 'p1']);
  });

  it('returns the new build untouched when nothing failed', () => {
    const next = [];
    expect(carryOverFailedSources(current, next, [])).toBe(next);
  });
});

describe('horizons', () => {
  const feed = [
    item('posting', 'app.bsky.feed.post', 'p2', '2026-10-27T10:00:00Z'),
    item('logging', 'is.dame.now', 's2', '2026-10-26T09:00:00Z'),
    item('posting', 'net.anisota.feed.post', 'a1', '2026-10-25T10:00:00Z'),
    item('logging', 'is.dame.now', 's1', '2026-10-24T09:00:00Z'),
  ];
  const horizons = { posting: '2026-10-26T12:00:00Z' };

  it("drops a verb's rows from past where its capped fetch ran out", () => {
    expect(
      trimToHorizons(feed, horizons).map((i) => i.atUri.split('/').pop()),
    ).toEqual(['p2', 's2', 's1']);
    expect(trimToHorizons(feed, null)).toBe(feed);
    expect(trimToHorizons(feed, {})).toBe(feed);
  });

  it('marks where the verb runs out, between the rows either side of it', () => {
    const out = insertHorizonMarkers(trimToHorizons(feed, horizons), horizons);
    expect(
      out.map((i) =>
        isHorizonMarker(i) ? `|${i.horizonVerb}` : i.atUri.split('/').pop(),
      ),
    ).toEqual(['p2', '|posting', 's2', 's1']);
    const marker = out[1];
    expect(marker.rowKey).toBe('horizon:posting');
  });

  it('dates a marker by the row above it, so it never heads a day of its own', () => {
    const out = insertHorizonMarkers(trimToHorizons(feed, horizons), horizons);
    expect(out[1].createdAt).toBe(feed[0].createdAt);
  });

  it('puts a marker older than everything at the end, where the verb stops', () => {
    const out = insertHorizonMarkers(feed.slice(0, 2), {
      logging: '2026-01-01T00:00:00Z',
    });
    const last = out[out.length - 1];
    expect(isHorizonMarker(last)).toBe(true);
    // Under the last day there is, not under New Year's Day.
    expect(last.createdAt).toBe(feed[1].createdAt);
  });

  it('skips the marker for a verb the filtered feed has no rows of', () => {
    const logsOnly = feed.filter((i) => i.verb === 'logging');
    expect(insertHorizonMarkers(logsOnly, horizons)).toBe(logsOnly);
  });
});

describe('assignRowKeys', () => {
  const play = (rkey, at) => item('listening', 'fm.teal.feed.play', rkey, at);

  it('keeps a listening session on one key as new plays join it', () => {
    const before = collapseListens([
      play('b', '2026-10-27T10:10:00Z'),
      play('a', '2026-10-27T10:00:00Z'),
    ]);
    const first = assignRowKeys(before);
    const key = first.rows[0].rowKey;
    expect(key).toBe(uri('fm.teal.feed.play', 'b'));

    const after = collapseListens([
      play('c', '2026-10-27T10:20:00Z'),
      play('b', '2026-10-27T10:10:00Z'),
      play('a', '2026-10-27T10:00:00Z'),
    ]);
    const second = assignRowKeys(after, first.keys);
    // The head is now the new play, but the row is the same session.
    expect(second.rows[0].atUri).toBe(uri('fm.teal.feed.play', 'c'));
    expect(second.rows[0].rowKey).toBe(key);
  });

  it('keys a night of moths by the night', () => {
    const moth = (rkey, date, time) =>
      item(
        'mothing',
        'is.dame.mothing.observation',
        rkey,
        `${date}T${time}:00Z`,
        {
          payload: { observedDate: date, observedTime: time },
        },
      );
    const rows = collapseObservations([
      moth('2', '2026-10-17', '23:00'),
      moth('1', '2026-10-17', '22:00'),
    ]);
    expect(assignRowKeys(rows).rows[0].rowKey).toBe('night:mothing:2026-10-17');
  });

  it('leaves ordinary rows as they are, keyed by their URI', () => {
    const rows = [
      item('posting', 'app.bsky.feed.post', 'p', '2026-10-27T10:00:00Z'),
    ];
    const out = assignRowKeys(rows);
    expect(out.rows[0]).toBe(rows[0]);
    expect(out.keys.get(rows[0].atUri)).toBe(rows[0].atUri);
  });

  it('never hands two rows the same key', () => {
    const previous = new Map([
      [uri('fm.teal.feed.play', 'a'), 'old'],
      [uri('fm.teal.feed.play', 'z'), 'old'],
    ]);
    // Two sessions (more than an hour apart), each with a member that used
    // to belong to the same row.
    const rows = collapseListens([
      play('b', '2026-10-27T12:00:00Z'),
      play('a', '2026-10-27T11:55:00Z'),
      play('y', '2026-10-27T09:00:00Z'),
      play('z', '2026-10-27T08:55:00Z'),
    ]);
    const keys = assignRowKeys(rows, previous).rows.map((r) => r.rowKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('old');
  });
});

describe('completeSince', () => {
  const feed = [
    item('posting', 'app.bsky.feed.post', 'p1', '2026-10-27T10:00:00Z'),
    item('listening', 'fm.teal.alpha.feed.play', 'l1', '2026-10-27T09:00:00Z'),
    item('logging', 'is.dame.now', 's1', '2026-10-20T09:00:00Z'),
  ];

  it('is the newest horizon of the verbs on show', () => {
    const horizons = {
      posting: '2026-10-24T17:31:00Z',
      listening: '2026-10-22T08:00:00Z',
    };
    expect(completeSince(feed, horizons)).toBe('2026-10-24T17:31:00.000Z');
  });

  it("ignores a verb the filter hides, and is null when nothing ran out", () => {
    const horizons = { reposting: '2026-10-26T00:00:00Z', listening: '2026-10-22T08:00:00Z' };
    expect(completeSince(feed, horizons)).toBe('2026-10-22T08:00:00.000Z');
    expect(completeSince(feed, { reposting: '2026-10-26T00:00:00Z' })).toBeNull();
    expect(completeSince(feed, null)).toBeNull();
    expect(completeSince([], { posting: '2026-10-26T00:00:00Z' })).toBeNull();
  });
});

describe('splitYearOnlyWorks', () => {
  it('takes works dated by their year out of the timeline', () => {
    const feed = [
      item('creating', 'is.dame.creating.work', 'w2', '2026-03-04T15:00:00Z'),
      item('logging', 'is.dame.now', 's1', '2026-01-01T00:00:00.000Z'),
      item('creating', 'is.dame.creating.work', 'w1', '2014-01-01T00:00:00.000Z'),
      item('creating', 'is.dame.creating.work', 'w0', '2011-01-01T00:00:00.000Z'),
    ];
    const { dated, yearOnly } = splitYearOnlyWorks(feed);
    // Only works: a status logged at that instant is a real time.
    expect(dated.map((i) => i.atUri.split('/').pop())).toEqual(['w2', 's1']);
    expect(yearOnly.map((i) => i.atUri.split('/').pop())).toEqual(['w1', 'w0']);
  });

  it('hands the timeline back as it was when there are none', () => {
    const feed = [item('posting', 'app.bsky.feed.post', 'p1', '2026-10-27T10:00:00Z')];
    expect(splitYearOnlyWorks(feed).dated).toBe(feed);
    expect(splitYearOnlyWorks(null)).toEqual({ dated: [], yearOnly: [] });
  });
});

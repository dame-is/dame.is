import { describe, it, expect } from 'vitest';
import {
  firstSightingCount,
  firstSightingIds,
  firstSightingLabel,
  isFirstSighting,
  markFirstSightings,
  mergeFirstSightings,
  observedTaxonIds,
} from './firstSightings.js';

/** A normalized iNaturalist observation, as /mothing holds one. */
const obs = ({ id, taxon, date, time = null, rank = 'species' }) => ({
  id,
  observedDate: date,
  observedTime: time,
  taxon: { id: taxon, name: `Taxon ${taxon}`, rank },
});

/** The same sighting as the home feed holds it: record value under `payload`. */
const item = (o) => ({
  verb: 'mothing',
  atUri: `at://did:plc:x/is.dame.mothing.observation/${o.id}`,
  payload: { inatId: o.id, observedDate: o.observedDate, observedTime: o.observedTime, taxon: o.taxon },
});

describe('firstSightingIds', () => {
  it('marks the earliest sighting of a taxon and nothing after it', () => {
    const ids = firstSightingIds([
      obs({ id: 3, taxon: 100, date: '2026-08-20' }),
      obs({ id: 1, taxon: 100, date: '2026-05-01' }),
      obs({ id: 2, taxon: 100, date: '2026-06-11' }),
    ]);
    expect([...ids]).toEqual([1]);
  });

  it('gives every taxon its own first', () => {
    const ids = firstSightingIds([
      obs({ id: 1, taxon: 100, date: '2026-05-01' }),
      obs({ id: 2, taxon: 200, date: '2026-05-02' }),
      obs({ id: 3, taxon: 100, date: '2026-05-03' }),
    ]);
    expect(ids).toEqual(new Set([1, 2]));
  });

  it('splits a shared date on the wall-clock', () => {
    const ids = firstSightingIds([
      obs({ id: 9, taxon: 100, date: '2026-08-18', time: '23:40' }),
      obs({ id: 8, taxon: 100, date: '2026-08-18', time: '21:05' }),
    ]);
    expect([...ids]).toEqual([8]);
  });

  it('prefers a timed sighting over a timeless one on the same date', () => {
    const ids = firstSightingIds([
      obs({ id: 4, taxon: 100, date: '2026-08-18' }),
      obs({ id: 5, taxon: 100, date: '2026-08-18', time: '22:15' }),
    ]);
    expect([...ids]).toEqual([5]);
  });

  it('falls back to the iNaturalist id when date and clock tie', () => {
    const ids = firstSightingIds([
      obs({ id: 77, taxon: 100, date: '2026-08-18', time: '22:15' }),
      obs({ id: 42, taxon: 100, date: '2026-08-18', time: '22:15' }),
    ]);
    expect([...ids]).toEqual([42]);
  });

  it('skips coarser-than-species IDs — they claim no species', () => {
    const ids = firstSightingIds([
      obs({ id: 1, taxon: 100, date: '2026-05-01', rank: 'genus' }),
      obs({ id: 2, taxon: 200, date: '2026-05-02', rank: 'family' }),
      obs({ id: 3, taxon: 300, date: '2026-05-03', rank: 'complex' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('counts infraspecific ranks — a subspecies is still a species claim', () => {
    const ids = firstSightingIds([
      obs({ id: 1, taxon: 100, date: '2026-05-01', rank: 'subspecies' }),
      obs({ id: 2, taxon: 200, date: '2026-05-02', rank: 'variety' }),
    ]);
    expect(ids).toEqual(new Set([1, 2]));
  });

  it('ignores an observation with no taxon at all', () => {
    expect(firstSightingIds([{ id: 1, observedDate: '2026-05-01', taxon: {} }]).size).toBe(0);
  });

  it('reads a feed item the same as a bare observation', () => {
    const ids = firstSightingIds([
      item(obs({ id: 2, taxon: 100, date: '2026-06-11' })),
      item(obs({ id: 1, taxon: 100, date: '2026-05-01' })),
    ]);
    expect([...ids]).toEqual([1]);
  });

  it('reads a raw PDS record too', () => {
    const ids = firstSightingIds([
      { uri: 'at://x/y/1', value: { inatId: 1, observedDate: '2026-05-01', taxon: { id: 100, rank: 'species' } } },
    ]);
    expect([...ids]).toEqual([1]);
  });

  it('never awards a first to a taxon already seen elsewhere', () => {
    const ids = firstSightingIds([obs({ id: 5, taxon: 100, date: '2026-05-01' })], {
      seenTaxa: new Set([100]),
    });
    expect(ids.size).toBe(0);
  });

  it('is empty for nothing', () => {
    expect(firstSightingIds(null).size).toBe(0);
    expect(firstSightingIds([]).size).toBe(0);
  });
});

describe('observedTaxonIds', () => {
  it('collects every taxon, coarse ones included — they are still seen', () => {
    const taxa = observedTaxonIds([
      obs({ id: 1, taxon: 100, date: '2026-05-01' }),
      obs({ id: 2, taxon: 200, date: '2026-05-02', rank: 'genus' }),
      obs({ id: 3, taxon: 100, date: '2026-05-03' }),
    ]);
    expect(taxa).toEqual(new Set([100, 200]));
  });
});

describe('mergeFirstSightings', () => {
  // The archive as the last build knew it: two firsts, three taxa on the list.
  const index = { ids: [1, 2], taxa: [100, 200, 300] };

  it('keeps the prebuilt firsts', () => {
    expect(mergeFirstSightings(index, [])).toEqual(new Set([1, 2]));
  });

  it('adds a sighting of a taxon the index has never seen', () => {
    const ids = mergeFirstSightings(index, [obs({ id: 9, taxon: 400, date: '2026-09-14' })]);
    expect(ids).toEqual(new Set([1, 2, 9]));
  });

  it('gives a brand-new taxon only its earliest sighting', () => {
    const ids = mergeFirstSightings(index, [
      obs({ id: 10, taxon: 400, date: '2026-09-14', time: '23:10' }),
      obs({ id: 9, taxon: 400, date: '2026-09-14', time: '21:02' }),
    ]);
    expect(ids).toEqual(new Set([1, 2, 9]));
  });

  it('does not re-award a taxon the index already holds', () => {
    // The window is short and starts after taxon 100's real first — which is
    // precisely the case that would invent one without the taxon list.
    const ids = mergeFirstSightings(index, [obs({ id: 50, taxon: 100, date: '2026-09-14' })]);
    expect(ids).toEqual(new Set([1, 2]));
  });

  it('takes the index as Sets too — which is how the hook hands it over', () => {
    const asSets = { ids: new Set([1, 2]), taxa: new Set([100, 200, 300]) };
    expect(mergeFirstSightings(asSets, [obs({ id: 50, taxon: 100, date: '2026-09-14' })])).toEqual(
      new Set([1, 2]),
    );
  });

  it('marks nothing at all without an index, rather than guessing from the window', () => {
    // A window holds the NEWEST sightings and a first is the OLDEST, so
    // deriving from one wouldn't under-report — it would hand the mark to the
    // wrong moth. Surfaces holding the whole archive call firstSightingIds.
    const window = [
      obs({ id: 2, taxon: 100, date: '2026-06-11' }),
      obs({ id: 1, taxon: 100, date: '2026-05-01' }),
    ];
    expect(mergeFirstSightings(null, window).size).toBe(0);
    expect(mergeFirstSightings({ ids: [], taxa: [] }, window).size).toBe(0);
  });
});

describe('isFirstSighting', () => {
  const ids = new Set([1]);

  it('matches on the iNaturalist id, through any envelope', () => {
    expect(isFirstSighting(obs({ id: 1, taxon: 100, date: '2026-05-01' }), ids)).toBe(true);
    expect(isFirstSighting(item(obs({ id: 1, taxon: 100, date: '2026-05-01' })), ids)).toBe(true);
    expect(isFirstSighting(obs({ id: 2, taxon: 100, date: '2026-05-02' }), ids)).toBe(false);
  });

  it('is false with no set to check against', () => {
    expect(isFirstSighting(obs({ id: 1, taxon: 100, date: '2026-05-01' }), null)).toBe(false);
    expect(isFirstSighting(null, ids)).toBe(false);
  });
});

describe('markFirstSightings', () => {
  const ids = new Set([1, 3]);
  const feed = [
    item(obs({ id: 1, taxon: 100, date: '2026-08-18' })),
    item(obs({ id: 2, taxon: 200, date: '2026-08-18' })),
    { verb: 'posting', atUri: 'at://x/app.bsky.feed.post/a', payload: { text: 'hi' } },
  ];

  it('flags the firsts and leaves everything else alone', () => {
    const marked = markFirstSightings(feed, ids);
    expect(marked.map((i) => Boolean(i._firstSighting))).toEqual([true, false, false]);
  });

  it('does not touch a non-observation whose payload happens to carry an id', () => {
    // An are.na block id could collide with an iNaturalist observation id;
    // nothing but the two iNaturalist verbs is ever compared against them.
    const block = { verb: 'curating', payload: { id: 1, title: 'a block' } };
    expect(markFirstSightings([block], ids)[0]._firstSighting).toBeUndefined();
  });

  it('passes the feed through untouched when there is nothing to mark', () => {
    expect(markFirstSightings(feed, new Set())).toBe(feed);
  });
});

describe('firstSightingCount', () => {
  it('counts the firsts a collapsed run is standing in for', () => {
    const run = markFirstSightings(
      [1, 2, 3, 4].map((id) => item(obs({ id, taxon: id * 10, date: '2026-08-18' }))),
      new Set([1, 3]),
    );
    expect(firstSightingCount({ observations: run })).toBe(2);
  });

  it('falls back to the row itself when it stands for nothing', () => {
    expect(firstSightingCount({ _firstSighting: true })).toBe(1);
    expect(firstSightingCount({})).toBe(0);
  });
});

describe('firstSightingLabel', () => {
  it('drops the number in the singular', () => {
    expect(firstSightingLabel(1)).toBe('First sighting');
    expect(firstSightingLabel(3)).toBe('3 first sightings');
    expect(firstSightingLabel(0)).toBe('');
  });
});

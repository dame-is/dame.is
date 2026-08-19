import { describe, it, expect } from 'vitest';
import {
  batchCountLabel,
  batchHref,
  batchNameLine,
  batchNames,
  collapseObservations,
  isObservationBatch,
  observationNightDate,
} from './observationBatches.js';

// A feed item as the home feed sees one: a verb, an at:// URI, the record
// value under `payload`, and a createdAt derived from the observation's own
// date + wall-clock (see observedTimestamp in inaturalist.js).
function obs({ verb = 'mothing', id, date, time, name = null, sci = 'Noctua pronuba', photo = true }) {
  return {
    verb,
    atUri: `at://did:plc:x/is.dame.${verb}.observation/${id}`,
    createdAt: `${date}T${time || '12:00'}:00.000Z`,
    payload: {
      inatId: id,
      url: `https://www.inaturalist.org/observations/${id}`,
      observedDate: date,
      observedTime: time,
      taxon: { id, name: sci, commonName: name },
      photos: photo ? [{ id, url: `https://static.inaturalist.org/photos/${id}/square.jpg` }] : [],
    },
  };
}

const post = (id, at) => ({ verb: 'posting', atUri: `at://did:plc:x/app.bsky.feed.post/${id}`, createdAt: at, payload: { text: 'hi' } });

describe('observationNightDate', () => {
  it('keeps an evening sighting on its own date', () => {
    expect(observationNightDate(obs({ id: 1, date: '2026-08-18', time: '21:05' }))).toBe('2026-08-18');
  });

  it('files an after-midnight sighting under the night that opened it', () => {
    expect(observationNightDate(obs({ id: 2, date: '2026-08-19', time: '01:47' }))).toBe('2026-08-18');
  });

  it('is null in daylight — a moth at noon is no night at the light', () => {
    expect(observationNightDate(obs({ id: 3, date: '2026-08-18', time: '13:20' }))).toBeNull();
  });

  it('is null without a time, and null for the observing verb entirely', () => {
    expect(observationNightDate(obs({ id: 4, date: '2026-08-18', time: null }))).toBeNull();
    expect(observationNightDate(obs({ verb: 'observing', id: 5, date: '2026-08-18', time: '21:05' }))).toBeNull();
  });

  it('reads a live observation\'s own hour when it carries one', () => {
    const live = obs({ id: 6, date: '2026-08-19', time: null });
    live.payload.observedHour = 1;
    expect(observationNightDate(live)).toBe('2026-08-18');
  });
});

describe('collapseObservations', () => {
  it('gathers a night — across midnight — into one row', () => {
    const night = [
      obs({ id: 3, date: '2026-08-19', time: '01:47', name: 'Zebra Conchylodes Moth' }),
      obs({ id: 2, date: '2026-08-18', time: '23:43', name: 'Tersa Sphinx' }),
      obs({ id: 1, date: '2026-08-18', time: '21:05', name: 'Angel Moth' }),
    ];
    const [batch, ...rest] = collapseObservations(night);
    expect(rest).toEqual([]);
    expect(batch.count).toBe(3);
    expect(batch.nightDate).toBe('2026-08-18');
    expect(batch.observations.map((o) => o.payload.inatId)).toEqual([3, 2, 1]);
  });

  it('dates and addresses the batch as its newest member', () => {
    const [batch] = collapseObservations([
      obs({ id: 3, date: '2026-08-19', time: '01:47' }),
      obs({ id: 1, date: '2026-08-18', time: '21:05' }),
    ]);
    expect(batch.createdAt).toBe('2026-08-19T01:47:00.000Z');
    expect(batch.atUri).toContain('/3');
  });

  it('keeps separate nights separate, however close they sit', () => {
    const out = collapseObservations([
      obs({ id: 2, date: '2026-08-19', time: '21:00' }),
      obs({ id: 1, date: '2026-08-18', time: '21:00' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.nightDate)).toEqual(['2026-08-19', '2026-08-18']);
  });

  it("lets other records through without closing an open run", () => {
    const out = collapseObservations([
      obs({ id: 2, date: '2026-08-18', time: '23:43' }),
      post('p1', '2026-08-18T23:00:00.000Z'),
      obs({ id: 1, date: '2026-08-18', time: '21:05' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(2);
    expect(out[1].verb).toBe('posting');
  });

  it('batches an observing run by proximity instead — it has no session', () => {
    const walk = [
      obs({ verb: 'observing', id: 3, date: '2026-08-12', time: '13:40' }),
      obs({ verb: 'observing', id: 2, date: '2026-08-12', time: '13:20' }),
      obs({ verb: 'observing', id: 1, date: '2026-08-12', time: '13:05' }),
    ];
    const [batch] = collapseObservations(walk);
    expect(batch.count).toBe(3);
    expect(batch.nightDate).toBeNull();
  });

  it('starts a new observing run once the gap opens past an hour', () => {
    const out = collapseObservations([
      obs({ verb: 'observing', id: 2, date: '2026-08-12', time: '16:00' }),
      obs({ verb: 'observing', id: 1, date: '2026-08-12', time: '13:00' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps one run per verb, so a moth on a walk fragments neither', () => {
    const out = collapseObservations([
      obs({ verb: 'observing', id: 4, date: '2026-08-12', time: '13:40' }),
      obs({ verb: 'mothing', id: 3, date: '2026-08-12', time: '21:30' }),
      obs({ verb: 'observing', id: 2, date: '2026-08-12', time: '13:20' }),
      obs({ verb: 'mothing', id: 1, date: '2026-08-12', time: '21:10' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => [b.verb, b.count])).toEqual([
      ['observing', 2],
      ['mothing', 2],
    ]);
  });

  it('never merges a daytime moth into a night', () => {
    const out = collapseObservations([
      obs({ id: 2, date: '2026-08-18', time: '21:05' }),
      obs({ id: 1, date: '2026-08-18', time: '20:30' }),
      obs({ id: 0, date: '2026-08-18', time: '13:00' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(2);
    expect(out[1].count).toBe(1);
  });

  it('passes a feed with nothing to collapse straight through', () => {
    const items = [post('a', '2026-08-18T10:00:00.000Z'), post('b', '2026-08-18T09:00:00.000Z')];
    expect(collapseObservations(items)).toEqual(items);
    expect(collapseObservations(null)).toEqual([]);
  });
});

describe('isObservationBatch', () => {
  const [single] = collapseObservations([obs({ id: 1, date: '2026-08-18', time: '21:05' })]);
  const [many] = collapseObservations([
    obs({ id: 2, date: '2026-08-18', time: '22:05' }),
    obs({ id: 1, date: '2026-08-18', time: '21:05' }),
  ]);

  it('is false for a lone sighting, which still renders as itself', () => {
    expect(isObservationBatch(single)).toBe(false);
  });

  it('is true once a row stands in for more than one', () => {
    expect(isObservationBatch(many)).toBe(true);
  });

  it('is false for every other verb', () => {
    expect(isObservationBatch({ verb: 'listening', count: 4, observations: [1, 2] })).toBe(false);
  });
});

describe('batch labels', () => {
  const batchOf = (...items) => collapseObservations(items)[0];
  const night = batchOf(
    obs({ id: 4, date: '2026-08-18', time: '23:50', name: 'Luna Moth' }),
    obs({ id: 3, date: '2026-08-18', time: '23:40', name: 'Angel Moth' }),
    obs({ id: 2, date: '2026-08-18', time: '23:30', name: 'Tersa Sphinx' }),
    obs({ id: 1, date: '2026-08-18', time: '23:20', name: 'Luna Moth' }),
  );

  it('names the species in the order the run is drawn, deduped', () => {
    expect(batchNames(night)).toEqual(['Luna Moth', 'Angel Moth', 'Tersa Sphinx']);
  });

  it('falls back to the binomial, and skips what has no name at all', () => {
    const mixed = batchOf(
      obs({ id: 2, date: '2026-08-18', time: '23:30', name: null, sci: 'Actias luna' }),
      obs({ id: 1, date: '2026-08-18', time: '23:20', name: null, sci: '' }),
    );
    expect(batchNames(mixed)).toEqual(['Actias luna']);
  });

  it('trails off once the line has said enough', () => {
    expect(batchNameLine(night, 2)).toBe('Luna Moth, Angel Moth + 1 more');
    expect(batchNameLine(night, 3)).toBe('Luna Moth, Angel Moth, Tersa Sphinx');
  });

  it('counts in the verb\'s own noun', () => {
    expect(batchCountLabel(night)).toBe('4 moths');
    expect(batchCountLabel({ verb: 'observing', count: 12 })).toBe('12 observations');
    expect(batchCountLabel({ verb: 'observing', count: 1 })).toBe('1 observation');
  });

  it('points a mothing run at its night, and anything else at nothing', () => {
    expect(batchHref(night)).toBe('/mothing/2026-08-18');
    expect(batchHref({ verb: 'observing', count: 3 })).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { isMothTaxon, normalizeObservation, buildSessions } from './inaturalist.js';
import { LEPIDOPTERA_TAXON_ID, BUTTERFLY_TAXON_ID } from '../config.js';

// The moth/observing split is: a moth is Lepidoptera (47157) MINUS butterflies
// (Papilionoidea, 47224). Everything else — butterflies included — rides the
// `observing` verb. The decision is read from the taxon's ancestry
// (`ancestor_ids`, which iNaturalist includes the taxon's own id in) plus its
// own id.
const LEP = LEPIDOPTERA_TAXON_ID; // 47157
const BFLY = BUTTERFLY_TAXON_ID; // 47224

describe('isMothTaxon', () => {
  it('is false for a missing taxon', () => {
    expect(isMothTaxon(null)).toBe(false);
    expect(isMothTaxon(undefined)).toBe(false);
  });

  it('is true for Lepidoptera that are not butterflies', () => {
    // A moth species whose ancestry passes through Lepidoptera but not butterflies.
    expect(isMothTaxon({ id: 82020, ancestor_ids: [1, 47120, LEP, 47932] })).toBe(true);
    // The Lepidoptera order id itself, via the taxon's own id.
    expect(isMothTaxon({ id: LEP, ancestor_ids: [] })).toBe(true);
  });

  it('is false for butterflies (the boundary: Lepidoptera AND butterfly)', () => {
    // A butterfly is Lepidoptera but also descends from Papilionoidea -> excluded.
    expect(isMothTaxon({ id: 55626, ancestor_ids: [LEP, BFLY] })).toBe(false);
    // The Papilionoidea superfamily itself (own id is the butterfly clade).
    expect(isMothTaxon({ id: BFLY, ancestor_ids: [LEP] })).toBe(false);
  });

  it('is false for non-Lepidoptera (birds, plants, fungi…)', () => {
    expect(isMothTaxon({ id: 12345, ancestor_ids: [1, 573] })).toBe(false);
  });

  it('is false for an untaxoned / malformed taxon', () => {
    expect(isMothTaxon({ id: null })).toBe(false);
    expect(isMothTaxon({})).toBe(false);
    // A non-array ancestor_ids is treated as empty; only the own id counts.
    expect(isMothTaxon({ id: 999, ancestor_ids: 'nope' })).toBe(false);
    expect(isMothTaxon({ id: LEP, ancestor_ids: 'nope' })).toBe(true);
  });
});

describe('normalizeObservation classification', () => {
  it('returns null when there is no observation', () => {
    expect(normalizeObservation(null)).toBeNull();
  });

  it('flags a moth observation as isMoth', () => {
    const n = normalizeObservation({
      id: 1,
      taxon: { id: 999, ancestor_ids: [LEP], name: 'Actias luna', rank: 'species' },
    });
    expect(n.isMoth).toBe(true);
  });

  it('routes a butterfly to the observing verb (isMoth false)', () => {
    const n = normalizeObservation({
      id: 2,
      taxon: { id: 55626, ancestor_ids: [LEP, BFLY], name: 'Danaus plexippus' },
    });
    expect(n.isMoth).toBe(false);
  });

  it('routes a non-Lepidoptera observation to observing (isMoth false)', () => {
    const n = normalizeObservation({
      id: 3,
      taxon: { id: 5, ancestor_ids: [1, 573], name: 'Cardinalis cardinalis' },
    });
    expect(n.isMoth).toBe(false);
  });

  it('strips every location signal (privacy choke point)', () => {
    const n = normalizeObservation({
      id: 4,
      taxon: { id: 999, ancestor_ids: [LEP] },
      // All of these are location hints that must never survive normalization.
      location: '40.0,-75.0',
      place_guess: 'Philadelphia, PA',
      geojson: { type: 'Point', coordinates: [-75, 40] },
      place_ids: [1, 2, 3],
      time_observed_at: '2020-05-07T21:30:00-04:00',
    });
    for (const leaked of ['location', 'place_guess', 'geojson', 'place_ids']) {
      expect(Object.prototype.hasOwnProperty.call(n, leaked)).toBe(false);
    }
    // Only the tz-free local wall-clock survives from the timestamp.
    expect(n.observedTime).toBe('21:30');
    expect(JSON.stringify(n)).not.toContain('-04:00');
  });
});

describe('buildSessions ordering', () => {
  // One night: an evening sighting (before midnight) plus two after-midnight
  // ones that roll back into the same session date. Input is deliberately
  // shuffled so the ordering under test can't pass by accident.
  const oneNight = [
    { id: 'b', observedDate: '2026-07-19', observedHour: 0, observedTime: '00:36' }, // 12:36am
    { id: 'a', observedDate: '2026-07-18', observedHour: 22, observedTime: '22:05' }, // 10:05pm
    { id: 'c', observedDate: '2026-07-19', observedHour: 1, observedTime: '01:17' }, // 1:17am
  ];

  it('groups an evening + after-midnight night into a single session', () => {
    const { sessions, orphans } = buildSessions(oneNight);
    expect(orphans).toHaveLength(0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].date).toBe('2026-07-18');
    expect(sessions[0].observationCount).toBe(3);
  });

  it('orders observations within a session newest-first', () => {
    const [night] = buildSessions(oneNight).sessions;
    // Latest sighting of the night sits on top; earliest at the bottom.
    expect(night.observations.map((o) => o.id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps the header time span chronological (earliest → latest)', () => {
    const [night] = buildSessions(oneNight).sessions;
    expect(night.firstTime).toBe('22:05');
    expect(night.lastTime).toBe('01:17');
  });
});

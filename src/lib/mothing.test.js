import { describe, it, expect } from 'vitest';
import {
  dateRange,
  findNight,
  formatNightDate,
  formatNightDay,
  nightLength,
  nightSpanCompact,
  seasonOf,
  seasonsOf,
  weekdayOf,
  formatObservedTime,
  isCalendarDate,
  isNightSlug,
  mothLightboxImages,
  mothName,
  nightBeyondReach,
  nightCardCopy,
  nightPath,
  nightSpan,
  nightSummaryParts,
} from './mothing.js';

// A normalized observation, the shape src/lib/inaturalist.js hands downstream:
// a date, a local wall-clock, a taxon, and photos. No location, ever.
function obs({ id, date, time, common = null, name = 'Noctua pronuba', photo = true }) {
  return {
    id,
    url: `https://www.inaturalist.org/observations/${id}`,
    observedDate: date,
    observedTime: time,
    observedHour: time ? Number(time.slice(0, 2)) : null,
    taxon: { id: id * 10, name, commonName: common, rank: 'species' },
    photos: photo ? [{ id: id * 100, url: `https://static.inaturalist.org/photos/${id}/square.jpg` }] : [],
  };
}

// One night that runs past midnight (so it spans two calendar dates), plus a
// separate earlier night and a daytime observation that belongs to neither.
const OBSERVATIONS = [
  obs({ id: 1, date: '2026-08-18', time: '21:05', common: 'Angel Moth' }),
  obs({ id: 2, date: '2026-08-18', time: '23:43', common: 'Tersa Sphinx' }),
  obs({ id: 3, date: '2026-08-19', time: '01:47', common: 'Zebra Conchylodes Moth' }),
  obs({ id: 4, date: '2026-08-16', time: '22:01', common: 'Luna Moth' }),
  obs({ id: 5, date: '2026-08-12', time: '13:20', common: 'A daytime moth' }),
];

describe('isNightSlug', () => {
  it('accepts a plain date — the form a night is addressed by', () => {
    expect(isNightSlug('2026-08-18')).toBe(true);
  });

  it('rejects an iNaturalist observation id, which shares the route', () => {
    expect(isNightSlug('392585028')).toBe(false);
  });

  it('rejects everything that is not exactly YYYY-MM-DD', () => {
    for (const slug of ['2026-8-18', '2026-08-18T00:00', 'latest', '', null, undefined]) {
      expect(isNightSlug(slug)).toBe(false);
    }
  });
});

describe('formatNightDate', () => {
  it('formats without Date(), so a date can never shift across a boundary', () => {
    expect(formatNightDate('2026-08-18')).toBe('Aug 18, 2026');
    expect(formatNightDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatNightDate('2026-12-31')).toBe('Dec 31, 2026');
  });

  it('returns empty for anything that is not a plain date', () => {
    expect(formatNightDate('nope')).toBe('');
    expect(formatNightDate(null)).toBe('');
  });

  it('returns empty for a date-shaped slug the calendar does not have', () => {
    expect(formatNightDate('2026-13-45')).toBe('');
    expect(formatNightDate('2026-00-10')).toBe('');
    expect(formatNightDate('2026-02-31')).toBe('');
    expect(formatNightDate('2026-04-31')).toBe('');
  });
});

describe('isCalendarDate', () => {
  it('knows the length of each month, leap years included', () => {
    expect(isCalendarDate('2026-01-31')).toBe(true);
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2100-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('2026-09-31')).toBe(false);
  });

  it('refuses out-of-range parts and anything not shaped YYYY-MM-DD', () => {
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-08-00')).toBe(false);
    expect(isCalendarDate('2026-8-18')).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
  });
});

describe('formatObservedTime', () => {
  it('reads a wall-clock as 12-hour, with midnight and noon at 12', () => {
    expect(formatObservedTime('20:47')).toBe('8:47 pm');
    expect(formatObservedTime('00:19')).toBe('12:19 am');
    expect(formatObservedTime('12:00')).toBe('12:00 pm');
    expect(formatObservedTime('01:47')).toBe('1:47 am');
  });

  it('returns empty for a missing or malformed time', () => {
    expect(formatObservedTime(null)).toBe('');
    expect(formatObservedTime('1:47')).toBe('');
  });
});

describe('mothName', () => {
  it('prefers the common name, falls back to the binomial, then to a label', () => {
    expect(mothName({ taxon: { commonName: 'Luna Moth', name: 'Actias luna' } })).toBe('Luna Moth');
    expect(mothName({ taxon: { name: 'Actias luna' } })).toBe('Actias luna');
    expect(mothName({ taxon: {} })).toBe('Unidentified moth');
    expect(mothName(null)).toBe('Unidentified moth');
  });
});

describe('nightPath', () => {
  it("addresses a night by its date — the session's own identity", () => {
    expect(nightPath('2026-08-18')).toBe('/mothing/2026-08-18');
  });
});

describe('findNight', () => {
  it('gathers an after-midnight observation into the night that began the evening before', () => {
    const found = findNight(OBSERVATIONS, '2026-08-18');
    expect(found.session.observationCount).toBe(3);
    expect(found.session.observations.map((o) => o.id).sort()).toEqual([1, 2, 3]);
  });

  it('hands back the nights either side, newest as `newer`', () => {
    const found = findNight(OBSERVATIONS, '2026-08-16');
    expect(found.newer.date).toBe('2026-08-18');
    expect(found.older).toBeNull();
  });

  it('is null for a date with no session — including a daytime observation', () => {
    expect(findNight(OBSERVATIONS, '2026-08-12')).toBeNull();
    expect(findNight(OBSERVATIONS, '2026-08-17')).toBeNull();
  });

  it('is null for a slug that is not a date, so an observation id never matches', () => {
    expect(findNight(OBSERVATIONS, '392585028')).toBeNull();
    expect(findNight([], '2026-08-18')).toBeNull();
  });
});

describe('nightBeyondReach', () => {
  // OBSERVATIONS runs to 2026-08-19 (the 1:47am sighting that closes the
  // Aug 18 night), so that is the leading edge of what it can answer for.
  it('is false for a date the set has already passed — a real miss', () => {
    expect(nightBeyondReach(OBSERVATIONS, '2026-08-17')).toBe(false);
    expect(nightBeyondReach(OBSERVATIONS, '2026-08-18')).toBe(false);
  });

  it('is true from the newest observation\'s own date on — tonight opens after it', () => {
    expect(nightBeyondReach(OBSERVATIONS, '2026-08-19')).toBe(true);
    expect(nightBeyondReach(OBSERVATIONS, '2026-09-01')).toBe(true);
  });

  it('is true when there is nothing to answer with at all', () => {
    expect(nightBeyondReach([], '2026-08-18')).toBe(true);
    expect(nightBeyondReach(null, '2026-08-18')).toBe(true);
  });
});

describe('nightSpan', () => {
  it('reads low to high across midnight', () => {
    expect(nightSpan(findNight(OBSERVATIONS, '2026-08-18').session)).toBe('9:05 pm – 1:47 am');
  });

  it('collapses to one time when a night holds only one', () => {
    expect(nightSpan(findNight(OBSERVATIONS, '2026-08-16').session)).toBe('10:01 pm');
  });

  it('is empty when nothing on the night carries a time', () => {
    expect(nightSpan({ firstTime: null, lastTime: null })).toBe('');
  });
});

describe('nightSummaryParts', () => {
  it('counts moths, species and the span', () => {
    expect(nightSummaryParts(findNight(OBSERVATIONS, '2026-08-18').session)).toEqual([
      '3 moths',
      '3 species',
      '9:05 pm – 1:47 am',
    ]);
  });

  it('leaves the hours out when the line has to stay short', () => {
    const session = findNight(OBSERVATIONS, '2026-08-18').session;
    expect(nightSummaryParts(session, { span: false })).toEqual(['3 moths', '3 species']);
  });

  it('singularises a night that caught one moth', () => {
    expect(nightSummaryParts(findNight(OBSERVATIONS, '2026-08-16').session)[0]).toBe('1 moth');
  });

  it('is empty for no session at all', () => {
    expect(nightSummaryParts(null)).toEqual([]);
  });
});

describe('nightCardCopy', () => {
  const copy = nightCardCopy(findNight(OBSERVATIONS, '2026-08-18').session);

  it('titles the night by its date', () => {
    expect(copy.title).toBe('Night of Aug 18, 2026');
  });

  it('names what was at the light, not just how much of it', () => {
    expect(copy.description).toContain('3 moths, 3 species, 9:05 pm – 1:47 am');
    expect(copy.description).toContain('Zebra Conchylodes Moth');
  });

  it('lists the names in the order the night is drawn, newest first', () => {
    expect(copy.names).toEqual(['Zebra Conchylodes Moth', 'Tersa Sphinx', 'Angel Moth']);
  });

  it('dedupes a species seen more than once in a night', () => {
    const twice = [
      obs({ id: 6, date: '2026-09-01', time: '21:00', common: 'Luna Moth' }),
      obs({ id: 7, date: '2026-09-01', time: '22:00', common: 'Luna Moth' }),
    ];
    expect(nightCardCopy(findNight(twice, '2026-09-01').session).names).toEqual(['Luna Moth']);
  });

  it('trails off rather than listing every name', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      obs({ id: 10 + i, date: '2026-09-02', time: `2${i % 4}:0${i}`, common: `Moth ${i}` }),
    );
    const long = nightCardCopy(findNight(many, '2026-09-02').session);
    expect(long.names).toHaveLength(6);
    expect(long.description).toMatch(/…$/);
  });
});

describe('mothLightboxImages', () => {
  const images = mothLightboxImages(findNight(OBSERVATIONS, '2026-08-18').session.observations);

  it('drops photoless observations so the viewer never opens on a blank', () => {
    const withNone = [obs({ id: 8, date: '2026-09-03', time: '21:00', photo: false })];
    expect(mothLightboxImages(withNone)).toEqual([]);
    expect(images).toHaveLength(3);
  });

  it('derives the large and thumbnail sizes from the stored square URL', () => {
    expect(images[0].src).toMatch(/\/large\.jpg$/);
    expect(images[0].thumb).toMatch(/\/medium\.jpg$/);
  });

  it('captions with both names when the moth has a common one', () => {
    expect(images[0].alt).toBe('Zebra Conchylodes Moth — Noctua pronuba');
  });

  it('carries no source or reverse-search controls — those are curating\'s', () => {
    expect(images[0].sourceUrl).toBeUndefined();
    expect(images[0].searchUrl).toBeUndefined();
  });
});

describe('the almanac helpers', () => {
  it('puts an evening in its meteorological season', () => {
    expect(seasonOf('2026-10-16')).toEqual({ key: '2026-3', label: 'Autumn 2026' });
    expect(seasonOf('2025-07-03').label).toBe('Summer 2025');
    expect(seasonOf('2026-04-17').label).toBe('Spring 2026');
    // December opens the next year's winter, named for both years.
    expect(seasonOf('2025-12-20')).toEqual({ key: '2026-0', label: 'Winter 2025–26' });
    expect(seasonOf('2026-02-02').label).toBe('Winter 2025–26');
  });

  it('names the weekday by calendar arithmetic', () => {
    expect(weekdayOf('2026-10-16')).toBe('Friday');
    expect(weekdayOf('2026-09-13')).toBe('Sunday');
  });

  it('writes the meridiem once when both ends share it', () => {
    expect(nightSpanCompact({ firstTime: '20:34', lastTime: '22:39' })).toBe('8:34–10:39 pm');
    expect(nightSpanCompact({ firstTime: '22:17', lastTime: '00:03' })).toBe('10:17 pm – 12:03 am');
    expect(nightSpanCompact({ firstTime: '21:00', lastTime: null })).toBe('9:00 pm');
  });

  it('measures the time at the light, across midnight too', () => {
    expect(nightLength({ firstTime: '20:34', lastTime: '22:39' })).toBe('2 h 5 min');
    expect(nightLength({ firstTime: '23:30', lastTime: '00:30' })).toBe('1 h');
  });

  it('sets a date range without the year', () => {
    expect(dateRange(['2026-10-16', '2026-09-13'])).toBe('Sep 13 – Oct 16');
    expect(formatNightDay('2026-10-16')).toBe('Oct 16');
  });

  it('groups nights by season, newest first, with a species tally', () => {
    const sp = (id) => ({ taxon: { id, rank: 'species' } });
    const seasons = seasonsOf([
      { date: '2026-10-16', observationCount: 2, observations: [sp(1), sp(2)] },
      { date: '2026-09-13', observationCount: 2, observations: [sp(2), sp(3)] },
      { date: '2026-07-01', observationCount: 1, observations: [sp(9)] },
    ]);
    expect(seasons.map((s) => s.label)).toEqual(['Autumn 2026', 'Summer 2026']);
    expect(seasons[0]).toMatchObject({ moths: 4, species: 3, range: 'Sep 13 – Oct 16' });
  });
});

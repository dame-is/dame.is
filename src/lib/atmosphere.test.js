import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_FORECAST,
  DEMO_READING,
  alertsFor,
  createPoll,
  forecastWords,
  formatIndex,
  formatRate,
  readForecast,
  readReading,
  recordsPerSecond,
} from './atmosphere.js';
import { createTidClock, readTid, s32, tidAt, tidDateText, tidTimeText } from './tid.js';

const reading = (over = {}) => readReading({ ...DEMO_READING, ...over });

describe('readReading', () => {
  it('keeps a reading that checks out', () => {
    const r = reading();
    expect(r.condition).toBe('gusty');
    expect(recordsPerSecond(r)).toBe(598.5);
    expect(r.apps[0].domain).toBe('teal.fm');
  });

  it('refuses what is not a reading, and drops odd parts', () => {
    expect(readReading(null)).toBeNull();
    expect(readReading({ ...DEMO_READING, condition: 'apocalyptic' })).toBeNull();
    const r = reading({ apps: [{ domain: '<script>', perSecond: 1, count: 1, collections: [] }, ...DEMO_READING.apps], diversity: { index: 1, level: 'weird' } });
    expect(r.apps.map((a) => a.domain)).not.toContain('<script>');
    expect(r.diversity).toBeUndefined();
  });
});

describe('readForecast', () => {
  it('keeps good hours', () => {
    const f = readForecast({ ...DEMO_FORECAST, hours: [...DEMO_FORECAST.hours, { t: 'x' }] });
    expect(f.hours).toHaveLength(6);
    expect(readForecast({})).toBeNull();
  });

  it('says the hours in a sentence', () => {
    expect(forecastWords(DEMO_FORECAST.hours, 'UTC')).toMatch(/^gusty until about 12 am, then calming down to breezy\.$/);
  });
});

describe('words', () => {
  it('formats rates and the index as the station does', () => {
    expect(formatRate(54.25)).toBe('54.3');
    expect(formatRate(598.5)).toBe('599');
    expect(formatIndex(0.37)).toBe('0.37');
    expect(formatIndex(1.56)).toBe('1.6');
  });
});

describe('alertsFor', () => {
  it('sets the scene first, then says what changed', () => {
    const calm = reading({ condition: 'breezy', apps: [] });
    const first = alertsFor(null, calm);
    expect(first.alerts).toEqual([]);
    const storm = alertsFor(first.watch, reading({ condition: 'stormy', apps: [{ domain: 'new.app', perSecond: 1, count: 40, collections: ['app.new.thing'] }] }));
    expect(storm.alerts.map((a) => a.kind)).toEqual(['storm', 'arrival']);
    const clear = alertsFor(storm.watch, reading({ condition: 'breezy' }));
    expect(clear.alerts.map((a) => a.kind)).toContain('clear');
  });

  it('does not say the same app blew in twice', () => {
    const a = alertsFor(null, reading());
    expect(alertsFor(a.watch, reading()).alerts.filter((x) => x.kind === 'arrival')).toEqual([]);
  });
});

describe('createPoll', () => {
  it('starts with the first listener, shares, and stops with the last', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    const timers = [];
    const poll = createPoll(load, () => 1000, { setTimer: (fn) => timers.push(fn), clearTimer: () => {} });
    const a = vi.fn();
    const b = vi.fn();
    const offA = poll.subscribe(a);
    poll.subscribe(b);
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).toHaveBeenCalledWith({ n: 1 });
    offA();
    expect(poll.get()).toEqual({ n: 1 });
  });
});

describe('tid', () => {
  it('encodes and reads back', () => {
    expect(s32(0, 2)).toBe('22');
    const tid = tidAt(1_762_372_800_000_000, 5);
    expect(tid).toHaveLength(13);
    expect(readTid(tid)).toEqual({ us: 1_762_372_800_000_000, clock: 5 });
    expect(readTid('self')).toBeNull();
  });

  it('never repeats', () => {
    const next = createTidClock(() => 1000, 1);
    const a = next();
    const b = next();
    expect(b.us).toBe(a.us + 1);
    expect(b.tid > a.tid).toBe(true);
  });

  it('says the time to the microsecond, in New York', () => {
    const us = Date.parse('2026-11-05T20:00:01.000Z') * 1000 + 123_456;
    expect(tidTimeText(us)).toBe('15:00:01.123456');
    expect(tidDateText(us)).toBe('thursday 5 november 2026');
  });
});

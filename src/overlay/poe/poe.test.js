import { describe, expect, it } from 'vitest';
import { DEMO_FORECAST, DEMO_READING, readReading } from '../../lib/atmosphere.js';
import { bobMs, idleGap, nextBeat, startIdle, MAX_WAVES } from './life.js';
import {
  AGAIN_MS,
  appsLine,
  commandOf,
  createGate,
  createRegulars,
  followLine,
  forecastLine,
  helloLine,
  petLine,
  weatherLine,
} from './lines.js';
import { MAX_QUEUED, enqueue } from './mount.js';
import { atHandle } from './brain.js';

const who = { handle: '@alice.test', avatar: null };

describe('Poe’s lines', () => {
  it('reads the weather, the apps and the forecast', () => {
    const r = readReading(DEMO_READING);
    expect(weatherLine(r, who)).toMatchObject({ label: 'weather report for @alice.test', text: 'gusty. lots going on out there' });
    expect(weatherLine(r, who).sub).toMatch(/^599 new records a second/);
    expect(appsLine(r, who).text).toBe('busiest outside bluesky: teal.fm, standard.site and tangled.org');
    expect(forecastLine(DEMO_FORECAST, who).text).toMatch(/^gusty until about/);
    expect(weatherLine(null, who).face).toBe('scawy');
  });

  it('says handles, never chatters’ words', () => {
    expect(helloLine(who, false, () => 0).text).toBe('hi @alice.test! welcome in (◕‿◕)');
    expect(helloLine({ handle: null }, true, () => 0).text).toBe('welcome back, friend! (◕‿◕)');
    expect(followLine(who)).toMatchObject({ hop: true, burst: 'leaves', sound: 'follow' });
    expect(petLine(who).sub).toMatch(/pets leaderboard/);
  });

  it('knows a command only at the start of a message', () => {
    expect(commandOf('  !POE')).toBe('poe');
    expect(commandOf('!weathery')).toBeNull();
  });

  it('gates by key', () => {
    let t = 0;
    const gate = createGate(() => t);
    expect(gate('a', 1000)).toBe(true);
    expect(gate('a', 1000)).toBe(false);
    t = 1000;
    expect(gate('a', 1000)).toBe(true);
  });

  it('greets once a stream, and welcomes a regular back', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    let t = 0;
    const first = createRegulars(storage, () => t);
    expect(first.greet('did:a')).toBe('hello');
    expect(first.greet('did:a')).toBeNull();
    t = AGAIN_MS + 1;
    expect(createRegulars(storage, () => t).greet('did:a')).toBe('welcome-back');
    t += 1;
    expect(createRegulars(storage, () => t).greet('did:a')).toBeNull();
  });

  it('shows a handle only when it is one', () => {
    expect(atHandle('dame.is')).toBe('@dame.is');
    expect(atHandle('handle.invalid')).toBeNull();
    expect(atHandle('<b>')).toBeNull();
  });
});

describe('Poe’s life', () => {
  it('rests longer than its longest beat, and waves a few times', () => {
    expect(idleGap(() => 0)).toBeGreaterThan(1600);
    const plan = startIdle();
    let waves = 0;
    for (let i = 0; i < 200; i += 1) if (nextBeat(plan, 7000, true, () => 0.9).kind === 'wave') waves += 1;
    expect(waves).toBe(MAX_WAVES);
  });

  it('breathes faster in a busy sky', () => {
    expect(bobMs(900)).toBeLessThan(bobMs(200));
    expect(bobMs(0)).toBe(3200);
  });

  it('keeps the most important lines when they pile up', () => {
    let q = [];
    for (let n = 0; n < 6; n += 1) q = enqueue(q, { text: `hello ${n}`, rank: 1 }, 0, n);
    q = enqueue(q, { text: 'follow', rank: 3 }, 0, 6);
    expect(q).toHaveLength(MAX_QUEUED);
    expect(q.map((x) => x.line.text)).toContain('follow');
    expect(q.map((x) => x.n)).toEqual([...q.map((x) => x.n)].sort((a, b) => a - b));
  });
});
